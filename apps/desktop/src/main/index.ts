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
  type UnlockAnswer,
  type UnlockRequest,
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
import { openAppDatabase } from "./db/open.js";
import { jsonFileStorage } from "./db/roster-storage.js";
import {
  passwordSidecarPath,
  readSidecar,
  recoverySidecarPath,
  writeSidecar,
} from "./db/sidecars.js";
import { storeFileState } from "./db/sqlite-header.js";
import { safeStorageKeyStore } from "./keystore/safe-storage-keystore.js";

// Reassigned whenever the store is replaced underneath a running app.
let driver: SqliteDriver;

// `dbPath` moves with custody, so every open re-derives it.
let dbPath: string;
let userDataPath: string;
let keystorePath: string;
let keyStore: KeyStore;

// Set while this device cannot prove which master key is the account's.
let custodyDegraded: { detail: string } | undefined;

// Read through a getter, so a store swap never re-registers a handler.
let activeCore: CoreApi | undefined;

// True while the store's handle is closed for replacement; every entry point
// that could fire then checks it rather than hit a closed driver.
let storeSwapping = false;

function setActiveCore(): void {
  activeCore = createCore(driver);
}

/** Built per call, so it reflects a conversion since the last read. */
function deviceRoster(): AccountRoster {
  return createAccountRoster(jsonFileStorage(join(userDataPath, ROSTER_PATH)));
}

/**
 * Open whichever store the roster points at and rebuild everything on it.
 * Re-entrant: see the desktop README → *Swapping the store in place*.
 */
async function openActiveStore(): Promise<void> {
  const activeStore = resolveActiveStore({
    accounts: await deviceRoster().list(),
  });

  // An Unauthenticated store beside an Authenticated one is a crashed account
  // creation's plaintext leftover, so sweep it.
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
  await seedHolidayCatalog({ driver });

  // Reports rather than throws: a Degraded device still opens its store.
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
  if (established.state === "degraded") {
    console.error(
      "this device's master key could not be re-adopted:",
      established.cause,
    );
  }
  setActiveCore();
}

/** Re-open after an operation replaced the store; the old handle is closed. */
async function reopenActiveStore(): Promise<void> {
  await openActiveStore();
  storeSwapping = false;
  // A swap can satisfy or reset the onboarding nudges; not awaited, since it
  // swallows its own failures.
  void regenerateSystemReminders();
  // Takes down the gate a sign out raised; a no-op after the other swaps.
  announceBootReady();
}

/**
 * Run an operation that replaces the store, and leave the app on a live store
 * even when it throws.
 */
async function withStoreSwap<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    await restoreLiveStore(); // a failure here is real — let it surface
    return result;
  } catch (cause) {
    // A restore failure must never replace the error that actually happened.
    try {
      await restoreLiveStore();
    } catch (error) {
      console.error("could not re-open the store after a failed swap:", error);
    }
    throw cause;
  }
}

// A failure before `closeStore` ran left the original store open and untouched.
async function restoreLiveStore(): Promise<void> {
  if (storeSwapping) await reopenActiveStore();
}

// Reads `dbPath` at call time, so it lands beside whichever store is live.
async function writeThisDeviceRecoveryDoor(door: Uint8Array): Promise<void> {
  writeSidecar(recoverySidecarPath(dbPath), door);
}

/**
 * Reconcile the automated birthday reminders, and refresh the renderer only if
 * anything changed. Best-effort: failures are logged and swallowed.
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

/** Tell every renderer to re-run the active route's loaders. */
function broadcastDataChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("app:changed");
  }
}

function asTagNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

// An omitted list stays omitted: `undefined` leaves a gift idea's tags alone,
// and `[]` would clear them.
function asOptionalTagNames(value: unknown): string[] | undefined {
  return value === undefined ? undefined : asTagNames(value);
}

/**
 * The channels that parse or coerce their raw IPC args before core sees them;
 * every other channel forwards its args unchanged.
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
  // A day count only: core decides the day and whether this row may be put off.
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
  // The idea payload itself is validated by the repo's own input schema.
  "gifts.ideas.create": (a) => [a[0], asOptionalTagNames(a[1])],
  "gifts.ideas.update": (a) => [a[0], a[1], asOptionalTagNames(a[2])],
  // Non-string input becomes an empty query, which returns no results.
  "search.query": (a) => [typeof a[0] === "string" ? a[0] : ""],
  // The renderer parsed the dropped file, so the whole payload is untrusted.
  "import.preview": (a) => [parsedContactsSchema.parse(a[0])],
  // The schema has no `sourceId`, so zod strips one: desktop has no address
  // book, and must not be able to write links for one.
  "import.commit": (a) => [importDecisionsSchema.parse(a[0])],
  "deviceContacts.setSyncEnabled": (a) => [a[0] === true],
};

/** Register every {@link CoreApi} channel as a forward to `getCore()`. */
function registerIpc(getCore: () => CoreApi): void {
  registerCoreHandlers({
    channels: API_CHANNELS,
    getCore,
    parsers: boundaryParsers,
    handle: (channel, handler) =>
      ipcMain.handle(channel, (_event, ...args) => handler(args)),
  });
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

/**
 * The `window.account` surface: custody operations that need the key store and
 * driver directly, so they sit outside {@link CoreApi}.
 */
function registerAccountIpc(): void {
  ipcMain.handle("account:status", () => getSyncStatus({ driver }));

  // Resolves with the recovery phrase only once the converted store is open,
  // so every core IPC is live by the time the renderer shows it.
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

  // Deletes the keys and re-opens, which lands on the boot path's unlock gate.
  // Resolves only after the user unlocks; the renderer follows the gate event.
  ipcMain.handle("account:signOut", async () => {
    if ((await getSyncStatus({ driver })).hasAccount !== true) {
      throw new Error(
        "There is no account on this device to sign out of. Create one to " +
          "protect your data with a password.",
      );
    }
    // Without a password door, only the 24-word phrase could get back in.
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

  // Forgetting on the last device is a deletion unless the relay durably holds
  // a copy, so ask it; silence counts as no copy.
  ipcMain.handle("account:forgetInfo", async () => {
    const { hasAccount, username, relayUrl } = await getSyncStatus({ driver });
    if (hasAccount !== true)
      throw new Error("There is no account on this device.");
    const { durableBackup } = await fetchRelayCapabilities({ relayUrl });
    return { username, relayUrl, durableBackup };
  });

  // The roster names the store to remove; with its entry gone, the re-open
  // lands on a fresh Unauthenticated store.
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

  // Erases the store, sidecars, roster and every keystore secret, then reloads
  // the renderer against the fresh Unauthenticated store.
  ipcMain.handle("app:factoryReset", async () => {
    await withStoreSwap(async () => {
      storeSwapping = true;
      await driver.close?.();
      factoryResetFiles({ dbPath, keystorePath, userDataPath });
    });
    mainWindow?.webContents.reload();
  });

  // The only route to a new recovery phrase after account creation.
  ipcMain.handle(
    "account:rotateRecoveryPhrase",
    async (_event, args: unknown) => {
      const { password } = (args ?? {}) as { password?: unknown };
      // Not `requireText`, which trims: a password is verified byte for byte.
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
 * A file in `resources/`, or `undefined` if it is not there. A packaged build
 * may put resources elsewhere, so callers treat a miss as "no icon".
 */
const resource = (name: string): string | undefined => {
  const path = join(__dirname, "../../resources", name);
  return existsSync(path) ? path : undefined;
};

/** Windows and Linux only; macOS takes its icon from the app bundle. */
const windowIcon = (): string | undefined => resource("icon.png");

// The name decides userData and the Keychain item: desktop README → *The app's
// name, and why it is a data boundary*. Must run before anything reads it.
if (!app.isPackaged) app.setName(`${app.getName()} Dev`);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    icon: windowIcon(),
    // Until the renderer's `<title>` takes over; untitled shows "Electron".
    title: "Leapsake",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set to the dev server by electron-vite in `dev`; unset when packaged.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

// Boot gate: `requestUnlock` parks until the renderer submits a secret.
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
    // Validated here: this input reaches key material before the app is alive.
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
 * Tell the renderer the core is live, ending a boot's or a sign out's gate.
 * A Degraded device is still ready, so `degraded` rides along.
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
  // There is no Dock before ready. The desktop README explains the macOS icon.
  const dockIcon = resource("icon-macos.png");
  if (dockIcon !== undefined) app.dock?.setIcon(dockIcon);

  userDataPath = app.getPath("userData");
  keystorePath = join(userDataPath, "keystore.json");
  keyStore = safeStorageKeyStore(keystorePath);

  // The window must exist before the DB opens, to host the unlock gate.
  registerBootIpc();
  mainWindow = createWindow();

  await openActiveStore();

  registerIpc(() => {
    if (storeSwapping) {
      throw new Error("Leapsake is updating its store. Try again in a moment.");
    }
    if (activeCore === undefined) throw new Error("Core is not initialized.");
    return activeCore;
  });
  registerAccountIpc();

  void regenerateSystemReminders();

  // A new local day can bring a birthday into range.
  app.on("browser-window-focus", () => {
    void regenerateSystemReminders();
  });

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
