import { join } from "node:path";
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
  getSyncStatus,
  joinAccountViaRelay,
  lookupAccount,
  registerAccountWithRelay,
  runAccountSync,
  runMigrations,
  withSyncKick,
} from "@leapsake/core";
import { type KeyStore, bytesToBase64 } from "@leapsake/crypto";
import {
  type ContactOwnerType,
  type EntityType,
  type MilestoneSubjectType,
  type RelationshipRole,
  createEmailInputSchema,
  createMilestoneInputSchema,
  createPersonInputSchema,
  createPetInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  createRelationshipInputSchema,
  updateEmailInputSchema,
  updateMilestoneInputSchema,
  updatePersonInputSchema,
  updatePetInputSchema,
  updatePhoneInputSchema,
  updatePostalInputSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import { DatabaseSync } from "node:sqlite";
import { BrowserWindow, app, ipcMain } from "electron";
import { nodeSqliteDriver } from "./db/node-sqlite-driver.js";
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

/** Push a background-sync activity update to every renderer (so Settings can show
 *  "last synced" / a non-fatal error even when the sync wasn't button-initiated).
 *  `changed` signals a pull that applied records, so the renderer can revalidate
 *  the active route in place (reactive invalidation). */
function broadcastSyncActivity(payload: {
  at?: number;
  error?: string;
  changed?: boolean;
}): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("sync:activity", payload);
  }
}

/** Coerce IPC-supplied tag names to a clean `string[]` before the repo dedupes. */
function asTagNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Register the typed IPC surface as a thin bridge over {@link CoreApi}. Every
 * operation — transactional writes, cascade deletes, relationship orientation,
 * label resolution — lives in `@leapsake/core`; these handlers only forward to
 * it. The IPC layer is the renderer's trust boundary, so before forwarding a
 * write it parses the payload with the matching Zod schema (the repo validates
 * again internally — cheap belt-and-suspenders) and coerces the loosely-typed
 * args (tag-name lists, the search term). It must **not** wrap calls in its own
 * `driver.transaction`: core already owns atomicity.
 */
function registerIpc(getCore: () => CoreApi): void {
  // A per-call indirection: each handler reads `core.<group>` through this proxy,
  // which resolves to the *current* core, so sync:join can swap the underlying
  // session without re-registering any handler.
  const core = new Proxy({} as CoreApi, {
    get: (_target, prop) => getCore()[prop as keyof CoreApi],
  });

  ipcMain.handle("people:list", () => core.people.list());
  ipcMain.handle("people:get", (_event, id: string) => core.people.get(id));
  ipcMain.handle("people:create", (_event, input: unknown, tagNames: unknown) =>
    core.people.create(
      createPersonInputSchema.parse(input),
      asTagNames(tagNames),
    ),
  );
  ipcMain.handle(
    "people:update",
    (_event, id: string, input: unknown, tagNames: unknown) =>
      core.people.update(
        id,
        updatePersonInputSchema.parse(input),
        asTagNames(tagNames),
      ),
  );
  ipcMain.handle("people:softDelete", (_event, id: string) =>
    core.people.softDelete(id),
  );

  ipcMain.handle("pets:list", () => core.pets.list());
  ipcMain.handle("pets:get", (_event, id: string) => core.pets.get(id));
  ipcMain.handle("pets:create", (_event, input: unknown, tagNames: unknown) =>
    core.pets.create(createPetInputSchema.parse(input), asTagNames(tagNames)),
  );
  ipcMain.handle(
    "pets:update",
    (_event, id: string, input: unknown, tagNames: unknown) =>
      core.pets.update(
        id,
        updatePetInputSchema.parse(input),
        asTagNames(tagNames),
      ),
  );
  ipcMain.handle("pets:softDelete", (_event, id: string) =>
    core.pets.softDelete(id),
  );

  ipcMain.handle("relationships:get", (_event, id: string) =>
    core.relationships.get(id),
  );
  ipcMain.handle("relationships:create", (_event, input: unknown) =>
    core.relationships.create(createRelationshipInputSchema.parse(input)),
  );
  ipcMain.handle("relationships:update", (_event, id: string, input: unknown) =>
    core.relationships.update(id, updateRelationshipInputSchema.parse(input)),
  );
  ipcMain.handle("relationships:softDelete", (_event, id: string) =>
    core.relationships.softDelete(id),
  );
  ipcMain.handle(
    "relationships:listForEntity",
    (_event, type: EntityType, id: string) =>
      core.relationships.listForEntity(type, id),
  );
  // Orientation writes: core implies/derives the roles and the repo validates the
  // assembled input, so the boundary forwards the loosely-typed args as-is.
  ipcMain.handle(
    "relationships:createFromSubject",
    (
      _event,
      input: Parameters<CoreApi["relationships"]["createFromSubject"]>[0],
    ) => core.relationships.createFromSubject(input),
  );
  ipcMain.handle(
    "relationships:editFromSubject",
    (
      _event,
      input: Parameters<CoreApi["relationships"]["editFromSubject"]>[0],
    ) => core.relationships.editFromSubject(input),
  );

  ipcMain.handle(
    "milestones:listForSubject",
    (_event, type: MilestoneSubjectType, id: string) =>
      core.milestones.listForSubject(type, id),
  );
  ipcMain.handle(
    "milestones:timelineFor",
    (_event, type: EntityType, id: string) =>
      core.milestones.timelineFor(type, id),
  );
  ipcMain.handle("milestones:create", (_event, input: unknown) =>
    core.milestones.create(createMilestoneInputSchema.parse(input)),
  );
  ipcMain.handle("milestones:update", (_event, id: string, input: unknown) =>
    core.milestones.update(id, updateMilestoneInputSchema.parse(input)),
  );
  ipcMain.handle("milestones:softDelete", (_event, id: string) =>
    core.milestones.softDelete(id),
  );

  ipcMain.handle(
    "contactMethods:listForOwner",
    (_event, type: ContactOwnerType, id: string) =>
      core.contactMethods.listForOwner(type, id),
  );
  ipcMain.handle("contactMethods:emails:create", (_event, input: unknown) =>
    core.contactMethods.emails.create(createEmailInputSchema.parse(input)),
  );
  ipcMain.handle(
    "contactMethods:emails:update",
    (_event, id: string, input: unknown) =>
      core.contactMethods.emails.update(
        id,
        updateEmailInputSchema.parse(input),
      ),
  );
  ipcMain.handle("contactMethods:emails:softDelete", (_event, id: string) =>
    core.contactMethods.emails.softDelete(id),
  );
  ipcMain.handle("contactMethods:phones:create", (_event, input: unknown) =>
    core.contactMethods.phones.create(createPhoneInputSchema.parse(input)),
  );
  ipcMain.handle(
    "contactMethods:phones:update",
    (_event, id: string, input: unknown) =>
      core.contactMethods.phones.update(
        id,
        updatePhoneInputSchema.parse(input),
      ),
  );
  ipcMain.handle("contactMethods:phones:softDelete", (_event, id: string) =>
    core.contactMethods.phones.softDelete(id),
  );
  ipcMain.handle("contactMethods:postals:create", (_event, input: unknown) =>
    core.contactMethods.postals.create(createPostalInputSchema.parse(input)),
  );
  ipcMain.handle(
    "contactMethods:postals:update",
    (_event, id: string, input: unknown) =>
      core.contactMethods.postals.update(
        id,
        updatePostalInputSchema.parse(input),
      ),
  );
  ipcMain.handle("contactMethods:postals:softDelete", (_event, id: string) =>
    core.contactMethods.postals.softDelete(id),
  );

  ipcMain.handle(
    "kinship:neighborsFor",
    (_event, type: EntityType, id: string) =>
      core.kinship.neighborsFor(type, id),
  );
  ipcMain.handle("kinship:genderFor", (_event, type: EntityType, id: string) =>
    core.kinship.genderFor(type, id),
  );
  ipcMain.handle(
    "kinship:dismiss",
    (
      _event,
      subjectType: EntityType,
      subjectId: string,
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole | null,
    ) => core.kinship.dismiss(subjectType, subjectId, otherType, otherId, role),
  );
  ipcMain.handle("kinship:undismiss", (_event, id: string) =>
    core.kinship.undismiss(id),
  );

  ipcMain.handle("tags:get", (_event, id: string) => core.tags.get(id));
  ipcMain.handle("tags:softDelete", (_event, id: string) =>
    core.tags.softDelete(id),
  );
  ipcMain.handle("tags:listForPerson", (_event, personId: string) =>
    core.tags.listForPerson(personId),
  );
  ipcMain.handle("tags:listForPet", (_event, petId: string) =>
    core.tags.listForPet(petId),
  );
  ipcMain.handle("tags:peopleForTag", (_event, tagId: string) =>
    core.tags.peopleForTag(tagId),
  );
  ipcMain.handle("tags:petsForTag", (_event, tagId: string) =>
    core.tags.petsForTag(tagId),
  );

  // Read-only global search. Non-string input from the boundary is coerced to an
  // empty query, which the service short-circuits to no results.
  ipcMain.handle("search:query", (_event, term: unknown) =>
    core.search.query(typeof term === "string" ? term : ""),
  );

  // Read-only view-model builders. Each forwards to the matching core view; the
  // builders only read, so there is nothing to parse at the boundary.
  ipcMain.handle("views:entityList", () => core.views.entityList());
  ipcMain.handle(
    "views:candidates",
    (_event, exclude?: { type: EntityType; id: string }) =>
      core.views.candidates(exclude),
  );
  ipcMain.handle(
    "views:relationshipNew",
    (_event, subjectType: EntityType, id: string) =>
      core.views.relationshipNew(subjectType, id),
  );
  ipcMain.handle("views:person", (_event, id: string) => core.views.person(id));
  ipcMain.handle("views:pet", (_event, id: string) => core.views.pet(id));
  ipcMain.handle("views:relationship", (_event, id: string) =>
    core.views.relationship(id),
  );
  ipcMain.handle("views:relationshipPartners", (_event, id: string) =>
    core.views.relationshipPartners(id),
  );
  ipcMain.handle(
    "views:relationshipForSubject",
    (_event, subjectType: EntityType, id: string, relId: string) =>
      core.views.relationshipForSubject(subjectType, id, relId),
  );
  ipcMain.handle(
    "views:derivedRelationship",
    (
      _event,
      subjectType: EntityType,
      id: string,
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole,
    ) =>
      core.views.derivedRelationship(subjectType, id, otherType, otherId, role),
  );
  ipcMain.handle(
    "views:milestoneSubject",
    (_event, subjectType: MilestoneSubjectType, id: string) =>
      core.views.milestoneSubject(subjectType, id),
  );
  ipcMain.handle(
    "views:milestoneNew",
    (_event, subjectType: MilestoneSubjectType, id: string) =>
      core.views.milestoneNew(subjectType, id),
  );
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
function registerSyncIpc(opts: { keyStore: KeyStore }): void {
  const { keyStore } = opts;

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
      void scheduler?.trigger(); // push the first device's data right away
      return { accountId: account.id, recoveryKey: bytesToBase64(recoveryKey) };
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
      void scheduler?.trigger(); // pull the account's data onto this fresh device
    },
  );

  // Run one push→pull cycle for the enabled account, routed through the scheduler
  // so the manual button and background syncs share single-flight. Returns the
  // completion time for a "last synced" indicator; a guarded skip (sync not
  // enabled) surfaces as the same error the direct call used to throw.
  ipcMain.handle("sync:now", async () => {
    const result = await scheduler?.trigger();
    if (result === undefined) {
      throw new Error("Sync is not enabled for this store.");
    }
    return result;
  });

  // Disconnect the account from this device: drop the account identity + the
  // password/recovery doors, keeping the enclave-held master key and all data so
  // the user can enable sync afresh. The held keySession (the enclave MK) is
  // unchanged, so the core needs no rebuild.
  ipcMain.handle("sync:clear", () => clearLocalAccount({ driver }));
}

function createWindow(): void {
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
}

void app.whenReady().then(async () => {
  const db = new DatabaseSync(join(app.getPath("userData"), "leapsake.db"));
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  const keyStore = safeStorageKeyStore(
    join(app.getPath("userData"), "keystore.json"),
  );
  keySession = await ensureDeviceMasterKey({ keyStore, driver });

  // Seamless background sync: the run thunk is the "is sync even enabled" guard
  // (a quiet no-op until an account is set up and relay-bound), reading the
  // current keySession so a later sync:join is picked up. Results/errors are
  // pushed to the renderer for the Settings "last synced" line.
  scheduler = createSyncScheduler({
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
    onError: (error) =>
      broadcastSyncActivity({
        error: error instanceof Error ? error.message : String(error),
      }),
  });

  setActiveCore(keySession);
  registerIpc(() => {
    if (activeCore === undefined) throw new Error("Core is not initialized.");
    return activeCore;
  });
  registerSyncIpc({ keyStore });

  scheduler.start(); // backstop interval
  void scheduler.trigger(); // initial on-launch sync

  // Pull the peer's edits in the moment the user returns to the app — the cheap,
  // event-driven companion to write-kicked pushes.
  app.on("browser-window-focus", () => {
    void scheduler?.trigger();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
