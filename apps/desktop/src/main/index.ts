import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AccountRoster,
  UNAUTHENTICATED_STORE_SLOT,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import {
  type AdoptionDoor,
  type CoreApi,
  type KeySession,
  type SqliteDriver,
  createCore,
  establishKeySession,
  fetchRelayCapabilities,
  getSyncStatus,
  lockThisDevice,
  MIN_PASSWORD_LENGTH,
  rotateRecoveryPhraseForAccount,
  runMigrations,
  seedHolidayCatalog,
} from "@leapsake/core";
import type { KeyStore } from "@leapsake/crypto";
import {
  createEmailInputSchema,
  createMilestoneInputSchema,
  createPersonInputSchema,
  createPetInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  createReminderInputSchema,
  createRelationshipInputSchema,
  snoozeDaysSchema,
  updateEmailInputSchema,
  updateMilestoneInputSchema,
  updatePersonInputSchema,
  updatePetInputSchema,
  updatePhoneInputSchema,
  updatePostalInputSchema,
  updateReminderInputSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import { importDecisionsSchema, parsedContactsSchema } from "@leapsake/vcard";
import { BrowserWindow, app, ipcMain } from "electron";
import { API_CHANNELS } from "../shared/api-channels.js";
import {
  type ApiChannel,
  type ArgParser,
  registerCoreHandlers,
} from "../shared/ipc-bridge.js";
import { destroyStoreFiles } from "./db/convert-store.js";
import { createAccountOnThisDevice } from "./db/create-account-flow.js";
import { factoryResetFiles } from "./db/factory-reset.js";
import { forgetAccountOnThisDevice } from "./db/forget-account-flow.js";
import {
  type UnlockAnswer,
  type UnlockRequest,
  openAppDatabase,
} from "./db/open.js";
import { jsonFileStorage } from "./db/roster-storage.js";
import {
  passwordSidecarPath,
  readSidecar,
  recoverySidecarPath,
  writeSidecar,
} from "./db/sidecars.js";
import { storeFileState } from "./db/sqlite-header.js";
import { safeStorageKeyStore } from "./keystore/safe-storage-keystore.js";

// The shared SQLite driver. Module-scoped so the core-rebuild and background-sync
// helpers below can reach it without threading — and **reassigned** whenever the
// store is replaced underneath a running app: account creation converts it to a
// new file, factory reset erases it. See {@link openActiveStore}.
let driver: SqliteDriver;

// Where this device's store and key material live. `dbPath` moves with custody
// (`stores/local/…` → `stores/<accountId>/…`), so it is re-derived on every open
// rather than captured once; the other three are fixed for the process.
let dbPath: string;
let userDataPath: string;
let keystorePath: string;
let keyStore: KeyStore;

// The unlocked device key material (custody Phase 0). Mutable because every store
// swap re-establishes it (see openActiveStore).
let keySession: KeySession | undefined;
export function getKeySession(): KeySession | undefined {
  return keySession;
}

// Why this device cannot prove which master key is the account's, when that is the
// case: the *Degraded* state (`model.md` §7.5). Set by every open, so a repaired
// device clears it by re-opening, and read by the boot IPC — the renderer keeps a
// banner up while it is set.
let custodyDegraded: { detail: string } | undefined;

// The live core the IPC handlers forward to. Reassigned whenever a store swap
// rebuilds it; registerIpc reads it through a getter so the handlers never need
// re-registering (ipcMain.handle throws on a second registration).
let activeCore: CoreApi | undefined;

// True from the instant the store's handle is closed for replacement until the
// new one is open. `driver` is unusable in that window, so every entry point that
// could fire during it checks this rather than letting better-sqlite3 raise
// "The database connection is not open" — an error that is alarming, tells the
// user nothing, and used to arrive from a window-focus handler while the
// one-time recovery phrase was on screen.
let storeSwapping = false;

/** Build the live core over the open driver. Called at bootstrap and again after
 *  every store swap. */
function setActiveCore(): void {
  activeCore = createCore(driver);
}

/**
 * This device's account roster — the unencrypted file that decides which store is
 * active and whether it is encrypted. Built per call rather than held, so it always
 * reflects a conversion that happened since the last read.
 */
function deviceRoster(): AccountRoster {
  return createAccountRoster(jsonFileStorage(join(userDataPath, ROSTER_PATH)));
}

/**
 * Open this device's store — whichever one the roster points at — and rebuild
 * everything that hangs off it: the driver, the migrations, the key session, and
 * the live core. The boot path's whole database half, extracted so it can run a
 * **second** time in the same process.
 *
 * That re-entrancy is the point. Two operations replace the store underneath a
 * running app — account creation (an Unauthenticated store is converted to an Authenticated one at
 * a new path, `model.md` §7.2.1) and factory reset (everything is erased) — and
 * both used to be followed by `app.relaunch()`. A relaunch is a bad answer twice
 * over: it is user-visible downtime at the worst possible moment (the recovery
 * phrase is on screen and shown only once), and under `electron-vite dev` it
 * *breaks the app*, because electron-vite exits with its Electron child and takes
 * the renderer dev server with it, leaving the relaunched instance loading a dead
 * `ELECTRON_RENDERER_URL`. Mobile never had a relaunch primitive and has always
 * re-run its bootstrap in place; this makes desktop behave the same way.
 *
 * Custody is re-resolved from the roster on every call rather than remembered, so
 * a store that changed custody since the last open is opened correctly.
 */
async function openActiveStore(): Promise<void> {
  // Which store, and in which custody state (@leapsake/store-layout). Both answers
  // come from the roster, which must be read before anything is opened — it is
  // readable precisely because it lives outside every store. `dbPath` is
  // *derived*, never a fixed `leapsake.db`.
  const activeStore = resolveActiveStore({
    accounts: await deviceRoster().list(),
  });

  // An Authenticated launch that still finds an Unauthenticated store crashed part-way through
  // account creation, after the roster entry but before the original was
  // destroyed. The leftover is a plaintext copy of exactly the data the user
  // asked to encrypt, so sweep it (create-account-flow.ts).
  if (activeStore.custody === "encrypted") {
    const strandedOpenStore = join(
      userDataPath,
      storePath(UNAUTHENTICATED_STORE_SLOT),
    );
    if (storeFileState(strandedOpenStore) !== "absent") {
      destroyStoreFiles(strandedOpenStore);
    }
  }
  dbPath = join(userDataPath, activeStore.path);

  // Open the store in that state: plaintext and keyless when Unauthenticated; when Authenticated,
  // the enclave key on a normal launch, minting on a fresh launch, or recovery from
  // the `.recovery` sidecar via a typed phrase if the enclave was wiped (open.ts).
  // The prompt is hosted by the renderer's gate.
  let unlockedBy: AdoptionDoor | undefined;
  driver = await openAppDatabase({
    dbPath,
    custody: activeStore.custody,
    keyStore,
    requestUnlock,
    onUnlocked: (door) => {
      unlockedBy = door;
    },
  });
  await runMigrations(driver);
  // The bundled holiday catalog, applied only when this install hasn't seen this
  // bundle yet. Cheap no-op on every launch after the first.
  await seedHolidayCatalog({ driver });

  // The key-custody half of the boot, in one call (custody slices 9/10): repair a
  // device that came back through an unlock door — a door unlock means the OS
  // keychain was lost, which took this device's master key with it — finish a repair
  // an earlier boot left half-done, and produce the key session the core is built
  // around. An Unauthenticated store gets none, since the master key is minted by account
  // creation, not here.
  //
  // It reports rather than throws: a device that cannot prove which master key is
  // the account's is *Degraded* — the store opens and the data is readable, but
  // `keySession` stays undefined. The renderer shows `custodyDegraded` and the
  // way out.
  const established = await establishKeySession({
    keyStore,
    driver,
    custody: activeStore.custody,
    door: unlockedBy,
    platform: "desktop",
  });
  custodyDegraded =
    established.state === "degraded"
      ? { detail: established.message }
      : undefined;
  keySession = established.state === "ok" ? established.keySession : undefined;
  if (established.state === "degraded") {
    console.error(
      "this device's master key could not be re-adopted:",
      established.cause,
    );
  }
  setActiveCore();
}

/**
 * Re-open the store after an operation replaced it, and hand the running app back
 * a working database. The caller has already closed the old handle (the file
 * cannot be converted or deleted while one is open), so between that close and
 * this call **every core IPC is pointed at a dead driver** — hence keeping that
 * window as short as an `await`.
 */
async function reopenActiveStore(): Promise<void> {
  await openActiveStore();
  storeSwapping = false;
  // Reconcile against the store that just arrived. Every swap can change what the
  // onboarding nudges are asking for — creating an account answers the account
  // invitation and the sign-in nudge both, and a factory reset puts a fresh store
  // back at the start of the sequence — and without this the answer would wait for
  // the next window focus, leaving a satisfied nudge on Home behind the one-time
  // recovery phrase. Deliberately not awaited: it is best-effort (it swallows its
  // own failures) and nothing here depends on it. It broadcasts `changed`, which
  // is what makes the renderer revalidate the list in place.
  void regenerateSystemReminders();
  // Take the gate back down. Only sign out (@leapsake/key-custody) actually raises it
  // mid-session — `openActiveStore` above parks inside `requestUnlock` until the
  // password lands, leaving the renderer on `RecoveryGate` — but announcing
  // unconditionally is right for the other swaps too: they leave the phase at
  // "ready", so this is a no-op the renderer ignores.
  announceBootReady();
}

/**
 * Run an operation that replaces the store, and leave the app on a live store
 * whatever happens — including when the operation throws.
 *
 * The two failure shapes need different answers, and {@link storeSwapping} is what
 * distinguishes them, because it is set by the operation's own `closeStore`
 * callback at the exact moment the handle dies. A failure *before* that leaves the
 * original store open and untouched, so there is nothing to restore. A failure
 * *after* it means the handle is gone and the app must genuinely re-open — and
 * re-resolving custody from the roster picks the right store either way: the
 * original if the conversion never got as far as a roster entry, the converted one
 * if it did.
 */
async function withStoreSwap<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    await restoreLiveStore(); // a failure here is real — let it surface
    return result;
  } catch (cause) {
    // Restore before rethrowing, but never let a restore failure *replace* the
    // error that actually happened — the mobile converter learned that one the
    // hard way, with a `finally` whose cleanup error hid the real cause.
    try {
      await restoreLiveStore();
    } catch (error) {
      console.error("could not re-open the store after a failed swap:", error);
    }
    throw cause;
  }
}

/** Put the app back on a live store: a genuine re-open when the handle was
 *  closed, otherwise a no-op — the original store is still open. */
async function restoreLiveStore(): Promise<void> {
  if (storeSwapping) await reopenActiveStore();
}

/**
 * Persist this device's at-rest **recovery door** beside the store it opens,
 * handed to the rotation that changes this device's recovery key.
 *
 * `dbPath` is read at call time, so this always lands beside whichever store is
 * live. The boot path writes the same file from the keychain key on every launch
 * (`open.ts`), which is what makes a missed write self-correcting rather than
 * permanent.
 */
async function writeThisDeviceRecoveryDoor(door: Uint8Array): Promise<void> {
  writeSidecar(recoverySidecarPath(dbPath), door);
}

/**
 * Reconcile the automated (`system`) reminders — upcoming birthdays — against the
 * live core, then, only if anything actually changed, refresh the renderer in
 * place. Called at boot and on window focus (a new local day can bring a birthday
 * into range). Best-effort: a failure here must never break launch, so it is
 * logged and swallowed.
 */
async function regenerateSystemReminders(): Promise<void> {
  if (activeCore === undefined || storeSwapping) return;
  try {
    const { created, updated, removed } =
      await activeCore.reminders.regenerateSystem();
    if (created > 0 || updated > 0 || removed > 0) broadcastDataChanged();
  } catch (error) {
    console.error("regenerate system reminders failed:", error);
  }
}

/** Tell every renderer that the main process changed rows behind its back, so it
 *  can re-run the active route's loaders in place. */
function broadcastDataChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("app:changed");
  }
}

/** Coerce IPC-supplied tag names to a clean `string[]` before the repo dedupes. */
function asTagNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * As {@link asTagNames}, but an **omitted** list stays omitted. A gift idea's
 * tags are an optional trailing argument where `undefined` means "leave them
 * alone" and `[]` means "clear them" (see `gifts.ideas.update`), so coercing the
 * absent case to `[]` here would silently wipe an idea's tags on any write that
 * didn't mention them.
 */
function asOptionalTagNames(value: unknown): string[] | undefined {
  return value === undefined ? undefined : asTagNames(value);
}

/**
 * The renderer trust boundary: the only channels that transform their raw IPC
 * args before forwarding to core. Writes Zod-parse their payload (the repo
 * validates again internally — cheap belt-and-suspenders) and reads coerce the
 * loosely-typed args (tag-name lists, the search term). Every other channel
 * forwards its args unchanged, so it isn't listed here.
 */
const boundaryParsers: Partial<Record<ApiChannel, ArgParser>> = {
  "people.create": (a) => [
    createPersonInputSchema.parse(a[0]),
    asTagNames(a[1]),
  ],
  "people.update": (a) => [
    a[0],
    updatePersonInputSchema.parse(a[1]),
    asTagNames(a[2]),
  ],
  "pets.create": (a) => [createPetInputSchema.parse(a[0]), asTagNames(a[1])],
  "pets.update": (a) => [
    a[0],
    updatePetInputSchema.parse(a[1]),
    asTagNames(a[2]),
  ],
  "relationships.create": (a) => [createRelationshipInputSchema.parse(a[0])],
  "relationships.update": (a) => [
    a[0],
    updateRelationshipInputSchema.parse(a[1]),
  ],
  "milestones.create": (a) => [createMilestoneInputSchema.parse(a[0])],
  "milestones.update": (a) => [a[0], updateMilestoneInputSchema.parse(a[1])],
  "reminders.create": (a) => [createReminderInputSchema.parse(a[0])],
  "reminders.update": (a) => [a[0], updateReminderInputSchema.parse(a[1])],
  // A day count, and only that: core decides which day it lands on and whether
  // this row may be put off at all, so a renderer can ask for nothing else.
  "reminders.snooze": (a) => [a[0], snoozeDaysSchema.parse(a[1])],
  "contactMethods.emails.create": (a) => [createEmailInputSchema.parse(a[0])],
  "contactMethods.emails.update": (a) => [
    a[0],
    updateEmailInputSchema.parse(a[1]),
  ],
  "contactMethods.phones.create": (a) => [createPhoneInputSchema.parse(a[0])],
  "contactMethods.phones.update": (a) => [
    a[0],
    updatePhoneInputSchema.parse(a[1]),
  ],
  "contactMethods.postals.create": (a) => [createPostalInputSchema.parse(a[0])],
  "contactMethods.postals.update": (a) => [
    a[0],
    updatePostalInputSchema.parse(a[1]),
  ],
  // A gift idea's tag list rides its create/update the way a Person's does; the
  // idea payload itself is validated by the repo's own input schema.
  "gifts.ideas.create": (a) => [a[0], asOptionalTagNames(a[1])],
  "gifts.ideas.update": (a) => [a[0], a[1], asOptionalTagNames(a[2])],
  // Read-only global search: non-string input coerces to an empty query, which
  // the service short-circuits to no results.
  "search.query": (a) => [typeof a[0] === "string" ? a[0] : ""],
  // Contact import: the renderer parses the dropped file and sends these across,
  // so the whole payload is untrusted and re-validated here against the parser's
  // own boundary schema before core touches the DB.
  "import.preview": (a) => [parsedContactsSchema.parse(a[0])],
  // The schema has no `sourceId`, so zod strips one a renderer sends: desktop
  // has no address book, and must not be able to write links for one.
  "import.commit": (a) => [importDecisionsSchema.parse(a[0])],
  "deviceContacts.setSyncEnabled": (a) => [a[0] === true],
};

/**
 * Register the typed IPC surface as a thin bridge over {@link CoreApi}. Every
 * operation lives in `@leapsake/core`; these handlers only forward to it — the
 * channel list (`API_CHANNELS`) and the two walkers in `shared/ipc-bridge.ts` do
 * the transcription that used to be hand-written per method. `getCore` is read
 * per call so `sync:join` can swap the session without re-registering, and the
 * boundary parses above run before forwarding. Handlers must **not** open their
 * own `driver.transaction`: core already owns atomicity.
 */
function registerIpc(getCore: () => CoreApi): void {
  registerCoreHandlers({
    channels: API_CHANNELS,
    getCore,
    parsers: boundaryParsers,
    handle: (channel, handler) =>
      ipcMain.handle(channel, (_event, ...args) => handler(args)),
  });
}

/** Reject a missing/blank string field from the renderer trust boundary. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

/**
 * The account custody surface, separate from {@link registerIpc} because it is
 * *not* part of {@link CoreApi}: creating an account wraps the device master key
 * under a password-derived KEK, so it needs the {@link KeyStore} + driver
 * directly rather than the transactional core. Exposed to the renderer as
 * `window.account` (a distinct bridge from `window.api`).
 */
function registerAccountIpc(): void {
  ipcMain.handle("account:status", () => getSyncStatus({ driver }));

  // **Create an account on this device** (@leapsake/key-custody) — the act that turns
  // encryption on. Fully local: no relay, no email, nothing leaves the machine.
  // Returns the recovery phrase for its one-time reveal.
  //
  // The store handle is closed and the file converted underneath us, so this
  // reopens the app around the new store before resolving. By the time the
  // renderer has the phrase to show, every core IPC is live again — the reveal is
  // a screen the user leaves when ready, not a countdown to a restart.
  ipcMain.handle(
    "account:create",
    async (_event, args: { username?: unknown; password?: unknown }) => {
      const username = requireText(args?.username, "Username");
      const password = args?.password;
      if (
        typeof password !== "string" ||
        password.length < MIN_PASSWORD_LENGTH
      ) {
        throw new Error(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        );
      }
      const { accountId, recoveryPhrase } = await withStoreSwap(() =>
        createAccountOnThisDevice({
          keyStore,
          driver,
          roster: deviceRoster(),
          userDataPath,
          username,
          password,
          closeStore: async () => {
            storeSwapping = true;
            await driver.close?.();
          },
        }),
      );
      return { accountId, recoveryPhrase };
    },
  );

  // **Sign out** (@leapsake/key-custody): close the store and forget the keys that open
  // it, so getting back in costs the password. Locked is a *state*, not a
  // separate mechanism — this reaches it by deleting the db-key + recovery key
  // and re-opening, which drops the boot path into its "the enclave is gone but
  // the encrypted file survives" case, i.e. the unlock gate the renderer already
  // hosts. One promise for both custody kinds: *nobody can see my data on this
  // device anymore*.
  //
  // The two guards are the difference between a lock and a lockout, and both
  // refuse rather than repair, because there is no safe repair from here:
  //  - **Unauthenticated store** — no account, so no keys and no password to come back with.
  //    Signing out would be a no-op that looks like one.
  //  - **No password door** — the sidecar is written by every path that
  //    establishes an account (creation, join, recovery), so its absence means a
  //    profile predating slice 5. Locking it would leave the 24-word phrase as
  //    the only way back, which is a support incident, not a sign out.
  //
  // Note this call resolves only *after* the user unlocks: `withStoreSwap`'s
  // re-open parks inside `requestUnlock` until a secret arrives. The renderer
  // doesn't wait on it — it switches to the gate on the `boot:unlock-needed`
  // event — so the pending promise is invisible.
  ipcMain.handle("account:signOut", async () => {
    if ((await getSyncStatus({ driver })).hasAccount !== true) {
      throw new Error(
        "There is no account on this device to sign out of. Create one to " +
          "protect your data with a password.",
      );
    }
    if (readSidecar(passwordSidecarPath(dbPath)) === undefined) {
      throw new Error(
        "This device has no password door, so signing out would lock the data " +
          "behind the recovery phrase alone.",
      );
    }
    await withStoreSwap(async () => {
      storeSwapping = true;
      await driver.close?.();
      await lockThisDevice({ keyStore });
    });
  });

  // What the **Forget account** confirmation needs to word itself honestly
  // (@leapsake/key-custody). Forgetting an account on its last device is functionally a
  // deletion *unless a server durably holds a copy* — so ask the relay, and treat
  // silence as "no copy". No relay implements the endpoint today, which is exactly
  // why this is a check and not a hardcoded warning: when server-side backup
  // ships, the alarming copy stops appearing on its own.
  ipcMain.handle("account:forgetInfo", async () => {
    const { hasAccount, username, relayUrl } = await getSyncStatus({ driver });
    if (hasAccount !== true)
      throw new Error("There is no account on this device.");
    const { durableBackup } = await fetchRelayCapabilities({ relayUrl });
    return { username, relayUrl, durableBackup };
  });

  // **Forget account** (@leapsake/key-custody): remove this account and its data from
  // this device — the store, both db-key doors, the roster entry, and the keys
  // that opened them. Local only; an account that exists on a relay or another
  // device is untouched there.
  //
  // The roster is the authority for *which* store, not the account row: it names
  // the directory, and it is the thing the next boot reads. With it gone the
  // re-open resolves to Unauthenticated and lands the device on a fresh plaintext store —
  // the same state a new install is in. The renderer is then reloaded, as it is
  // after a factory reset, because it is displaying rows that no longer exist.
  ipcMain.handle("account:forget", async () => {
    const active = resolveActiveStore({
      accounts: await deviceRoster().list(),
    });
    const accountId =
      active.custody === "encrypted" ? active.accountId : undefined;
    if (accountId === undefined) {
      throw new Error("There is no account on this device to forget.");
    }
    await withStoreSwap(() =>
      forgetAccountOnThisDevice({
        keyStore,
        roster: deviceRoster(),
        userDataPath,
        accountId,
        closeStore: async () => {
          storeSwapping = true;
          await driver.close?.();
        },
      }),
    );
    mainWindow?.webContents.reload();
  });

  // Factory reset: erase everything and come back up as a first-run install.
  // Unlike account:forget (which removes one account's slot), this deletes the
  // store, the recovery sidecar, the roster, and every keystore secret — so the
  // reopen that follows resolves custody as **Unauthenticated** and mints nothing, which is
  // exactly the fresh-install state (§7.2).
  //
  // The DB handle is closed first so the file is unlocked before it is removed.
  // The renderer is then reloaded rather than relaunched: it is displaying rows
  // that no longer exist, and a reload remounts it against the empty store
  // without the process (and, in dev, the renderer dev server) going away.
  ipcMain.handle("app:factoryReset", async () => {
    await withStoreSwap(async () => {
      storeSwapping = true;
      await driver.close?.();
      factoryResetFiles({ dbPath, keystorePath, userDataPath });
    });
    mainWindow?.webContents.reload();
  });

  // Replace this device's recovery phrase (model.md §6): a phrase is shown once
  // at account creation, and this rotation is the only later route to one.
  // The gate is the password, checked locally by core.
  ipcMain.handle(
    "account:rotateRecoveryPhrase",
    async (_event, args: unknown) => {
      const { password } = (args ?? {}) as { password?: unknown };
      // Not `requireText`: that trims, and a password is verified byte for byte
      // against a verifier derived from what the user actually typed.
      if (typeof password !== "string" || password === "") {
        throw new Error("Password is required.");
      }
      return rotateRecoveryPhraseForAccount({
        keyStore,
        driver,
        password,
        writeRecoveryDoor: writeThisDeviceRecoveryDoor,
      });
    },
  );
}

/**
 * A file in `resources/`, or `undefined` if it is not there.
 *
 * Resolved from the built `out/main/`, which reaches the repo copy in dev and in an
 * unpackaged build. A packaged build puts resources somewhere else; that path is a
 * decision for electron-builder to make when it arrives (plans/v0-2.md), so every caller
 * here treats a miss as "no icon" rather than asserting a file that will legitimately
 * move. An app that boots without its face is a better failure than one that does not boot.
 */
const resource = (name: string): string | undefined => {
  const path = join(__dirname, "../../resources", name);
  return existsSync(path) ? path : undefined;
};

/**
 * The window icon, generated from `assets/icon/logo_color.svg` by `pnpm icons`.
 *
 * Windows and Linux take the icon from the window; **macOS ignores this entirely** and
 * reads the app bundle instead — the Dock icon set in `whenReady` is the macOS half.
 */
const windowIcon = (): string | undefined => resource("icon.png");

/**
 * Every build is "Leapsake" (`productName`, which Electron reads before any of this runs);
 * an unpackaged one is "Leapsake Dev".
 *
 * **`app.name` is not a label**, which is the whole reason this is three lines and a long
 * comment. Electron derives three things from it, and only the first is cosmetic:
 *
 *   1. the wording *inside* the macOS app menu — "About Leapsake Dev", "Quit …";
 *   2. `app.getPath("userData")`, i.e. where this device's whole store lives;
 *   3. on macOS, the **Keychain item safeStorage wraps keys with** — the service is
 *      `<app.name> Safe Storage`, so the name decides which key `keystore.json` is sealed
 *      under. There is no API to ask safeStorage for a different one.
 *
 * (3) is why a rename cannot be undone by pinning. `app.setPath` can put `userData` back,
 * which makes a late rename *look* survivable while the enclave has quietly moved to a key
 * that decrypts none of the existing wraps.
 *
 * What makes this call safe is that it is not a *change* of name: it runs at module scope,
 * before `whenReady` and before anything has read `app.name`, and it runs identically on
 * every launch. A dev device is therefore only ever "Leapsake Dev" — store, Keychain item
 * and menu all agreeing from its first launch. Verified rather than assumed: with
 * `productName` "Leapsake", this lands `userData` on `…/Leapsake Dev` and safeStorage on
 * `Leapsake Dev Safe Storage`.
 *
 * The split is deliberate and not only cosmetic. `pnpm dev` ships breaking schema changes
 * without migrations (see the repo's pre-v0.1 stance), so a dev build must not be able to
 * open the store an installed Leapsake is using. Keeping the names apart is what enforces
 * that. **Changing either name is a data migration** — desktop README → *The app's face on
 * macOS*.
 *
 * `scripts/name-dev-bundle.mjs` stamps the same string onto the dev bundle, because the
 * menu-bar *title* comes from `CFBundleName` and is out of reach from here.
 */
// `app.getName()` is still `productName` at this point, so the suffix is the only thing
// stated here and the product is named in exactly one place — `package.json`.
if (!app.isPackaged) app.setName(`${app.getName()} Dev`);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    icon: windowIcon(),
    // The title until the renderer's own `<title>` takes over — a frame of "Electron"
    // otherwise, since a window with no title falls back to the bundle's name.
    title: "Leapsake",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL to the dev server in `dev`; in a
  // packaged build it is undefined and we load the built HTML from disk.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

// --- Boot gate (at-rest unlock, model.md §6 / §7.5). -----------------------
// The renderer mounts before the DB is open so it can host the unlock prompt when
// this device's enclave key is gone but the encrypted file + a sidecar survive.
// `requestUnlock` (passed into openAppDatabase) parks until the renderer submits a
// secret; a wrong one loops back here with an error and the gate re-prompts.

type BootPhase = "starting" | "recovering" | "ready";
let bootPhase: BootPhase = "starting";
let bootError: string | undefined;
/** Which doors the store being opened actually has, for the gate to offer. */
let bootDoors: UnlockRequest["doors"] = { password: false, phrase: false };
let mainWindow: BrowserWindow | undefined;
let unlockResolver: ((answer: UnlockAnswer) => void) | undefined;

function registerBootIpc(): void {
  ipcMain.handle("boot:status", () => ({
    phase: bootPhase,
    error: bootError,
    doors: bootDoors,
    degraded: custodyDegraded,
  }));
  ipcMain.handle("boot:unlock", (_event, answer: unknown) => {
    // Validate here rather than trusting the renderer: this is the one input that
    // reaches key material before anything else in the app is alive.
    const door = (answer as UnlockAnswer | undefined)?.door;
    const secret = (answer as UnlockAnswer | undefined)?.secret;
    if (
      (door !== "password" && door !== "phrase") ||
      typeof secret !== "string" ||
      unlockResolver === undefined
    ) {
      return;
    }
    const resolve = unlockResolver;
    unlockResolver = undefined;
    resolve({ door, secret });
  });
}

/**
 * Tell the renderer the core is live and it may render the app — the signal that
 * ends both a cold boot's unlock gate and a mid-session sign out's.
 *
 * It carries `degraded` because a store can open perfectly well on a device that
 * cannot prove its master key (custody slice 10): the app is usable, so this is
 * still "ready", but the renderer must say so and sync must stay off.
 */
function announceBootReady(): void {
  bootPhase = "ready";
  bootError = undefined;
  mainWindow?.webContents.send("boot:ready", { degraded: custodyDegraded });
}

function requestUnlock({ error, doors }: UnlockRequest): Promise<UnlockAnswer> {
  bootPhase = "recovering";
  bootError = error;
  bootDoors = doors;
  mainWindow?.webContents.send("boot:unlock-needed", { error, doors });
  return new Promise<UnlockAnswer>((resolve) => {
    unlockResolver = resolve;
  });
}

void app.whenReady().then(async () => {
  // The Dock icon, which macOS reads from the app bundle rather than from the window — so
  // in dev it is Electron's atom until something says otherwise. Here rather than at module
  // scope only because there is no Dock to set an icon on before ready.
  //
  // `icon-macos.png` rather than `icon.png`: macOS composites the file exactly as given
  // and supplies no mask, so the rounded tile and the margin it reserves for the badge and
  // the drop shadow have to be in the pixels. See `scripts/icons.mjs` → `PLATE`.
  const dockIcon = resource("icon-macos.png");
  if (dockIcon !== undefined) app.dock?.setIcon(dockIcon);

  userDataPath = app.getPath("userData");
  keystorePath = join(userDataPath, "keystore.json");
  keyStore = safeStorageKeyStore(keystorePath);

  // The renderer (and its recovery gate) need a window before the DB is opened,
  // and the boot IPC must be live before the renderer queries it.
  registerBootIpc();
  mainWindow = createWindow();

  // Resolve custody, open the store, and build the core around it. The same call
  // runs again if account creation or a factory reset replaces the store later.
  await openActiveStore();

  // The core is already built (openActiveStore). Both bridges read their target
  // through module state, so a later store swap needs no re-registration —
  // ipcMain.handle throws on a second registration anyway.
  registerIpc(() => {
    if (storeSwapping) {
      throw new Error("Leapsake is updating its store. Try again in a moment.");
    }
    if (activeCore === undefined) throw new Error("Core is not initialized.");
    return activeCore;
  });
  registerAccountIpc();

  void regenerateSystemReminders(); // populate today's birthdays atop Home

  // Regenerating on focus keeps a birthday appearing the day it comes into range
  // without a restart.
  app.on("browser-window-focus", () => {
    void regenerateSystemReminders();
  });

  // The core is live — let the gate render the app (the window was created up
  // front so any recovery prompt had somewhere to show).
  announceBootReady();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
