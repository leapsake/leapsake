import { join } from "node:path";
import {
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
} from "@leapsake/store-layout";
import {
  type CoreApi,
  type KeySession,
  type SqliteDriver,
  type SyncScheduler,
  clearLocalAccount,
  createCore,
  createSyncScheduler,
  enableSync,
  ensureDeviceMasterKey,
  getAutoSync,
  getSyncStatus,
  isRelayAuthError,
  joinAccountViaRelay,
  lookupAccount,
  reauthenticateViaRelay,
  recoverAccountViaRelay,
  reconcileOnJoin,
  registerAccountWithRelay,
  runAccountSync,
  runMigrations,
  seedHolidayCatalog,
  setAutoSync,
  withSyncKick,
} from "@leapsake/core";
import {
  type KeyStore,
  encodeRecoveryPhrase,
  ensureRecoveryKey,
} from "@leapsake/crypto";
import {
  createEmailInputSchema,
  createMilestoneInputSchema,
  createPersonInputSchema,
  createPetInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  createReminderInputSchema,
  createRelationshipInputSchema,
  updateEmailInputSchema,
  updateMilestoneInputSchema,
  updatePersonInputSchema,
  updatePetInputSchema,
  updatePhoneInputSchema,
  updatePostalInputSchema,
  updateReminderInputSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import {
  importDecisionsSchema,
  parsedContactsSchema,
} from "@leapsake/contact-import";
import { BrowserWindow, app, ipcMain } from "electron";
import { API_CHANNELS } from "../shared/api-channels.js";
import {
  type ApiChannel,
  type ArgParser,
  registerCoreHandlers,
} from "../shared/ipc-bridge.js";
import { factoryResetFiles } from "./db/factory-reset.js";
import { openAppDatabase } from "./db/open.js";
import { jsonFileStorage } from "./db/roster-storage.js";
import { safeStorageKeyStore } from "./keystore/safe-storage-keystore.js";

// The shared SQLite driver, assigned once in whenReady. Module-scoped so the
// core-rebuild and background-sync helpers below can reach it without threading.
let driver: SqliteDriver;

// The unlocked device key material (custody Phase 0), passed into createCore so
// it can encrypt sensitive fields at rest under per-item content keys. Mutable
// because joining an existing account (sync:join) adopts a *different* master key
// and rebuilds the core around it (see registerSyncIpc).
let keySession: KeySession | undefined;
export function getKeySession(): KeySession | undefined {
  return keySession;
}

// The live core the IPC handlers forward to. Reassigned when sync:join adopts the
// account master key; registerIpc reads it through a getter so the handlers never
// need re-registering (ipcMain.handle throws on a second registration). It is
// wrapped with withSyncKick so a renderer write debounce-kicks a background sync.
let activeCore: CoreApi | undefined;

// The background-sync scheduler (seamless sync): writes kick it, window focus and
// the interval trigger it, and the manual "Sync now" button routes through it so
// they share single-flight. Built in whenReady once the driver/keystore exist.
let scheduler: SyncScheduler | undefined;

/**
 * Build the live core around `session` and wrap it so each local write kicks a
 * (debounced) background sync. Used at bootstrap and again after sync:join adopts
 * a different master key. The kick reads `scheduler` lazily, so it is safe even
 * before the scheduler is built.
 */
function setActiveCore(session: KeySession | undefined): void {
  activeCore = withSyncKick(createCore(driver, session), () =>
    scheduler?.kick(),
  );
}

/**
 * Reconcile the automated (`system`) reminders — upcoming birthdays — against the
 * live core, then, only if anything actually changed, refresh the renderer in
 * place and kick a sync so the rows propagate. Called at boot and on window focus
 * (a new local day can bring a birthday into range). Best-effort: a failure here
 * must never break launch, so it is logged and swallowed. `regenerateSystem` is
 * not a sync-kicking mutation (it runs off a user write), hence the explicit kick.
 */
async function regenerateSystemReminders(): Promise<void> {
  if (activeCore === undefined) return;
  try {
    const { created, updated, removed } =
      await activeCore.reminders.regenerateSystem();
    if (created > 0 || updated > 0 || removed > 0) {
      broadcastSyncActivity({ changed: true });
      scheduler?.kick();
    }
  } catch (error) {
    console.error("regenerate system reminders failed:", error);
  }
}

/** Push a background-sync activity update to every renderer (so Settings can show
 *  "last synced" / a non-fatal error even when the sync wasn't button-initiated).
 *  `changed` signals a pull that applied records, so the renderer can revalidate
 *  the active route in place (reactive invalidation). */
function broadcastSyncActivity(payload: {
  at?: number;
  error?: string;
  changed?: boolean;
  needsReauth?: boolean;
}): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("sync:activity", payload);
  }
}

/** The user-facing prompt shown when a sync 401s because the account password was
 *  reset on another device. Both the background scheduler's `onError` and the
 *  manual "Sync now" path surface it, so it lives here to stay identical. */
const REAUTH_PROMPT =
  "Your password was changed on another device. Re-enter it to reconnect.";

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
  "import.commit": (a) => [importDecisionsSchema.parse(a[0])],
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

/**
 * Shortest password we'll let enable an account (kept in step with the UI's
 * `MIN_PASSWORD_LENGTH`). This password derives the KEK that protects the master
 * key in a *zero-knowledge* store, so its strength is the encryption strength —
 * and there is no server-side reset to fall back on. We enforce a 12-character
 * floor (length over complexity, per NIST) and the UI nudges toward a passphrase;
 * the recovery key is the real backstop (see security-review.md).
 */
const MIN_PASSWORD_LENGTH = 12;

/** Reject a missing/blank string field from the renderer trust boundary. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

/**
 * Turn a relay request failure into a message the user can act on. `fetch`
 * rejects with `TypeError: fetch failed` when the relay is unreachable (e.g. the
 * server isn't running); the transport throws `relay … failed: <status>` for an
 * HTTP error, so a 409 means the username is taken.
 */
function relayErrorMessage(cause: unknown, relayUrl: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("fetch failed")) {
    return `Couldn't reach the relay at ${relayUrl}. Make sure the sync server is running, then try again.`;
  }
  if (message.includes("409")) {
    return "That username is already taken on this relay. Pick another.";
  }
  if (message.includes("401")) {
    return "Incorrect username or password for this account.";
  }
  if (message.includes("404")) {
    return "No account found for that username on this relay.";
  }
  return `Relay request failed: ${message}`;
}

/**
 * The sync/account custody surface, separate from {@link registerIpc} because it
 * is *not* part of {@link CoreApi}: enabling sync wraps the device master key
 * under a password-derived KEK, so it needs the {@link KeyStore} + driver
 * directly rather than the transactional core. Exposed to the renderer as
 * `window.sync` (a distinct bridge from `window.api`).
 *
 * `sync:enable` is the renderer's trust boundary for the password, so it checks
 * the length here before deriving anything, and returns the one-time recovery
 * key **base64-encoded for display** — the raw key bytes never cross IPC.
 */
function registerSyncIpc(opts: {
  keyStore: KeyStore;
  dbPath: string;
  keystorePath: string;
  /** `userData` — factory reset clears the roster and `stores/` beneath it. */
  userDataPath: string;
}): void {
  const { keyStore, dbPath, keystorePath, userDataPath } = opts;

  ipcMain.handle("sync:status", () => getSyncStatus({ driver }));

  // Prelogin existence probe for the combined sign-up / log-in flow: does this
  // username already have an account on the relay? A connection failure surfaces
  // as the friendly "couldn't reach the relay" message.
  ipcMain.handle(
    "sync:lookup",
    async (_event, args: { username?: unknown; relayUrl?: unknown }) => {
      const username = requireText(args?.username, "Username");
      const relayUrl = requireText(args?.relayUrl, "Relay URL");
      try {
        return { exists: await lookupAccount({ relayUrl, username }) };
      } catch (cause) {
        throw new Error(relayErrorMessage(cause, relayUrl), { cause });
      }
    },
  );

  // Enable sync on this (first) device: establish the account + password door,
  // then register the bootstrap ciphertext with the relay so a second device can
  // log in. Returns the one-time recovery key base64-encoded for display.
  ipcMain.handle(
    "sync:enable",
    async (
      _event,
      args: { username?: unknown; password?: unknown; relayUrl?: unknown },
    ) => {
      const username = requireText(args?.username, "Username");
      const relayUrl = requireText(args?.relayUrl, "Relay URL");
      const password = args?.password;
      if (
        typeof password !== "string" ||
        password.length < MIN_PASSWORD_LENGTH
      ) {
        throw new Error(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        );
      }
      const { account, recoveryKey, bootstrap } = await enableSync({
        keyStore,
        driver,
        password,
        username,
        relayUrl,
        platform: "desktop",
      });
      // Registering with the relay is the second half of enabling; if it fails
      // (server down, username taken) roll the local account back so the user
      // can retry cleanly instead of being stuck half-enabled.
      try {
        await registerAccountWithRelay({ relayUrl, bootstrap });
      } catch (cause) {
        await clearLocalAccount({ driver });
        throw new Error(relayErrorMessage(cause, relayUrl), { cause });
      }
      void scheduler?.autoTrigger(); // push the first device's data right away
      return {
        accountId: account.id,
        recoveryKey: encodeRecoveryPhrase(recoveryKey),
      };
    },
  );

  // Join an existing account from this fresh device: log in over the relay,
  // adopt the account master key under this device's enclave, and rebuild the
  // core around it so encrypted fields use the adopted key.
  ipcMain.handle(
    "sync:join",
    async (
      _event,
      args: { username?: unknown; password?: unknown; relayUrl?: unknown },
    ) => {
      const username = requireText(args?.username, "Username");
      const relayUrl = requireText(args?.relayUrl, "Relay URL");
      const password = requireText(args?.password, "Password");
      try {
        keySession = await joinAccountViaRelay({
          keyStore,
          driver,
          relayUrl,
          username,
          password,
          platform: "desktop",
        });
      } catch (cause) {
        throw new Error(relayErrorMessage(cause, relayUrl), { cause });
      }
      setActiveCore(keySession);
      // Reconcile this device's pre-existing local people against the account:
      // pull first, then surface how many possible duplicates the join created
      // so the renderer can prompt the user to review them (no auto-merge).
      // Best-effort — a reconcile failure must not fail an otherwise-good join.
      let duplicateCount = 0;
      try {
        if (activeCore !== undefined) {
          ({ duplicateCount } = await reconcileOnJoin({
            driver,
            masterKey: keySession.masterKey,
            core: activeCore,
          }));
        }
      } catch {
        duplicateCount = 0;
      }
      void scheduler?.autoTrigger(); // push this device's data + pull any remainder
      return { duplicateCount };
    },
  );

  // Recover an existing account on this fresh device from the recovery phrase
  // (forgot password): unwrap MK from the relay's recovery escrow, set a new
  // password, adopt MK under this device's enclave, and rebuild the core.
  ipcMain.handle(
    "sync:recover",
    async (
      _event,
      args: {
        username?: unknown;
        recoveryPhrase?: unknown;
        newPassword?: unknown;
        relayUrl?: unknown;
      },
    ) => {
      const username = requireText(args?.username, "Username");
      const relayUrl = requireText(args?.relayUrl, "Relay URL");
      const recoveryPhrase = requireText(
        args?.recoveryPhrase,
        "Recovery phrase",
      );
      const newPassword = args?.newPassword;
      if (
        typeof newPassword !== "string" ||
        newPassword.length < MIN_PASSWORD_LENGTH
      ) {
        throw new Error(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        );
      }
      try {
        keySession = await recoverAccountViaRelay({
          keyStore,
          driver,
          relayUrl,
          username,
          recoveryPhrase,
          newPassword,
          platform: "desktop",
        });
      } catch (cause) {
        throw new Error(relayErrorMessage(cause, relayUrl), { cause });
      }
      setActiveCore(keySession);
      // Same post-join reconcile: a recovering device may hold local data too.
      let duplicateCount = 0;
      try {
        if (activeCore !== undefined) {
          ({ duplicateCount } = await reconcileOnJoin({
            driver,
            masterKey: keySession.masterKey,
            core: activeCore,
          }));
        }
      } catch {
        duplicateCount = 0;
      }
      void scheduler?.autoTrigger();
      return { duplicateCount };
    },
  );

  // Re-authenticate this device after the account password was reset elsewhere:
  // re-derive this device's relay credential from the re-entered password (the MK
  // stays in the enclave), then kick a sync so a success reconnects immediately.
  ipcMain.handle("sync:reauthenticate", async (_event, args: unknown) => {
    const password = requireText(
      (args as { password?: unknown } | undefined)?.password,
      "Password",
    );
    const { relayUrl } = await getSyncStatus({ driver });
    try {
      await reauthenticateViaRelay({ keyStore, driver, password });
    } catch (cause) {
      throw new Error(relayErrorMessage(cause, relayUrl ?? ""), { cause });
    }
    await scheduler?.trigger();
  });

  // Run one push→pull cycle for the enabled account, routed through the scheduler
  // so the manual button and background syncs share single-flight. Returns the
  // completion time for a "last synced" indicator; a guarded skip (sync not
  // enabled) surfaces as the same error the direct call used to throw.
  ipcMain.handle("sync:now", async () => {
    try {
      const result = await scheduler?.trigger();
      if (result === undefined) {
        throw new Error("Sync is not enabled for this store.");
      }
      return result;
    } catch (error) {
      // A manual "Sync now" 401s the same way a background sync does when the
      // password was reset on another device. The background path routes that to
      // the re-auth prompt via onError; do the same here (the scheduler's manual
      // trigger rethrows instead of calling onError) so the button surfaces the
      // friendly prompt, not a raw "failed: 401". The original error still
      // propagates (carrying the 401) so the caller can recognize it too.
      if (isRelayAuthError(error)) {
        broadcastSyncActivity({ error: REAUTH_PROMPT, needsReauth: true });
      }
      throw error;
    }
  });

  // Disconnect the account from this device: drop the account identity + the
  // password/recovery doors, keeping the enclave-held master key and all data so
  // the user can enable sync afresh. The held keySession (the enclave MK) is
  // unchanged, so the core needs no rebuild.
  ipcMain.handle("sync:clear", () => clearLocalAccount({ driver }));

  // Factory reset: erase everything and reopen as a first-run install. Unlike
  // sync:clear (which keeps the data and master key), this deletes the encrypted
  // DB, the recovery sidecar, and every keystore secret, then relaunches so the
  // next boot mints a fresh key over an empty DB. We close the DB handle first so
  // the file is unlocked before it is removed, then hard-restart the process:
  // app.relaunch queues a new instance, app.exit tears this one (and its held DB
  // handle + key material) down for real.
  ipcMain.handle("app:factoryReset", async () => {
    await driver.close?.();
    factoryResetFiles({ dbPath, keystorePath, userDataPath });
    app.relaunch();
    app.exit(0);
  });

  // The per-client "Sync automatically" preference (default on). Read at render
  // time for the Settings toggle; the setter persists it *and* flips the live
  // scheduler so the change takes effect immediately (and survives a restart).
  // Reveal this device's recovery phrase on demand (it lives in the enclave, so
  // it can be shown any time — not just the one-time enable reveal). The escape
  // hatch back into both the local file and a synced account (model.md §6).
  ipcMain.handle("sync:revealRecoveryPhrase", async () => {
    const recoveryKey = await ensureRecoveryKey(keyStore);
    return encodeRecoveryPhrase(recoveryKey);
  });

  ipcMain.handle("sync:getAutoSync", () => getAutoSync({ driver }));
  ipcMain.handle("sync:setAutoSync", async (_event, enabled: unknown) => {
    const next = enabled === true;
    await setAutoSync({ driver, enabled: next });
    scheduler?.setAutoEnabled(next);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
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

// --- Boot gate (at-rest recovery, model.md §6). ----------------------------
// The renderer mounts before the DB is open so it can host the recovery prompt
// when this device's enclave key is gone but the encrypted file + sidecar
// survive. `requestRecoveryPhrase` (passed into openAppDatabase) parks until the
// renderer submits a phrase; a wrong phrase loops back here with an error.

type BootPhase = "starting" | "recovering" | "ready";
let bootPhase: BootPhase = "starting";
let bootError: string | undefined;
let mainWindow: BrowserWindow | undefined;
let recoveryPhraseResolver: ((phrase: string) => void) | undefined;

function registerBootIpc(): void {
  ipcMain.handle("boot:status", () => ({ phase: bootPhase, error: bootError }));
  ipcMain.handle("boot:recovery", (_event, phrase: unknown) => {
    if (typeof phrase === "string" && recoveryPhraseResolver !== undefined) {
      const resolve = recoveryPhraseResolver;
      recoveryPhraseResolver = undefined;
      resolve(phrase);
    }
  });
}

function requestRecoveryPhrase({ error }: { error?: string }): Promise<string> {
  bootPhase = "recovering";
  bootError = error;
  mainWindow?.webContents.send("boot:recovery-needed", error);
  return new Promise<string>((resolve) => {
    recoveryPhraseResolver = resolve;
  });
}

void app.whenReady().then(async () => {
  const userData = app.getPath("userData");

  // Which store, and in which custody state (model.md §7.2/§7.4). Both answers
  // come from the roster, which must be read before anything is opened — it is
  // readable precisely because it lives outside every store. `dbPath` is
  // *derived*, never a fixed `leapsake.db`.
  const roster = createAccountRoster(
    jsonFileStorage(join(userData, ROSTER_PATH)),
  );
  const activeStore = resolveActiveStore({ accounts: await roster.list() });
  const dbPath = join(userData, activeStore.path);

  // The renderer (and its recovery gate) need a window before the DB is opened,
  // and the boot IPC must be live before the renderer queries it.
  registerBootIpc();
  mainWindow = createWindow();

  // Open the store in that state: plaintext and keyless when Open; when Protected,
  // the enclave key on a normal launch, minting on a fresh launch, or recovery from
  // the `.recovery` sidecar via a typed phrase if the enclave was wiped (open.ts).
  // The prompt is hosted by the renderer's gate.
  const keystorePath = join(userData, "keystore.json");
  const keyStore = safeStorageKeyStore(keystorePath);
  driver = await openAppDatabase({
    dbPath,
    custody: activeStore.custody,
    keyStore,
    requestRecoveryPhrase,
  });
  await runMigrations(driver);
  // The bundled holiday catalog, applied only when this install hasn't seen this
  // bundle yet. Cheap no-op on every launch after the first.
  await seedHolidayCatalog({ driver });
  // Custody Phase 0.5, not Phase 0: the master key is minted by account creation,
  // so an Open store has no key session at all and `createCore` runs without one.
  keySession =
    activeStore.custody === "protected"
      ? await ensureDeviceMasterKey({ keyStore, driver })
      : undefined;

  // Seamless background sync: the run thunk is the "is sync even enabled" guard
  // (a quiet no-op until an account is set up and relay-bound), reading the
  // current keySession so a later sync:join is picked up. Results/errors are
  // pushed to the renderer for the Settings "last synced" line.
  scheduler = createSyncScheduler({
    autoEnabled: await getAutoSync({ driver }),
    run: async () => {
      if (keySession === undefined) return undefined;
      const status = await getSyncStatus({ driver });
      if (!status.enabled || status.relayUrl === undefined) return undefined;
      return runAccountSync({ driver, masterKey: keySession.masterKey });
    },
    onResult: ({ at, applied }) =>
      broadcastSyncActivity({
        at,
        changed: applied !== undefined && applied > 0,
      }),
    onError: (error) => {
      // A 401 means the relay rejected this device's credential — almost always
      // because the password was reset on another device. Flag it so Settings can
      // prompt for the new password instead of showing a raw "failed: 401".
      if (isRelayAuthError(error)) {
        broadcastSyncActivity({ error: REAUTH_PROMPT, needsReauth: true });
        return;
      }
      // Any other background failure: log it (autoTrigger swallows the rejection
      // so it no longer surfaces in the terminal on its own) and surface it in UI.
      console.error("auto-sync failed:", error);
      broadcastSyncActivity({
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  setActiveCore(keySession);
  registerIpc(() => {
    if (activeCore === undefined) throw new Error("Core is not initialized.");
    return activeCore;
  });
  registerSyncIpc({ keyStore, dbPath, keystorePath, userDataPath: userData });

  scheduler.start(); // backstop interval
  void regenerateSystemReminders(); // populate today's birthdays atop Home
  void scheduler.autoTrigger(); // initial on-launch sync (skipped if auto off)

  // Pull the peer's edits in the moment the user returns to the app — the cheap,
  // event-driven companion to write-kicked pushes. Regenerating here too keeps a
  // birthday appearing the day it comes into range without a restart.
  app.on("browser-window-focus", () => {
    void regenerateSystemReminders();
    void scheduler?.autoTrigger();
  });

  // The core is live — let the gate render the app (the window was created up
  // front so any recovery prompt had somewhere to show).
  bootPhase = "ready";
  bootError = undefined;
  mainWindow?.webContents.send("boot:ready");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
