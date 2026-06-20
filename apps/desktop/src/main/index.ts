import { join } from "node:path";
import {
  type CoreApi,
  type KeySession,
  type SqliteDriver,
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  runMigrations,
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

// The unlocked device key material (custody Phase 0), passed into createCore so
// it can encrypt sensitive fields at rest under per-item content keys.
let keySession: KeySession | undefined;
export function getKeySession(): KeySession | undefined {
  return keySession;
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
function registerIpc(core: CoreApi): void {
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

/** Shortest password we'll let enable an account (kept in step with the UI). */
const MIN_PASSWORD_LENGTH = 8;

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
  driver: SqliteDriver;
  keyStore: KeyStore;
}): void {
  const { driver, keyStore } = opts;

  ipcMain.handle("sync:status", () => getSyncStatus({ driver }));

  ipcMain.handle("sync:enable", async (_event, password: unknown) => {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    const { account, recoveryKey } = await enableSync({
      keyStore,
      driver,
      password,
      platform: "desktop",
    });
    return { accountId: account.id, recoveryKey: bytesToBase64(recoveryKey) };
  });
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
  const driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  const keyStore = safeStorageKeyStore(
    join(app.getPath("userData"), "keystore.json"),
  );
  keySession = await ensureDeviceMasterKey({ keyStore, driver });
  const core = createCore(driver, keySession);
  registerIpc(core);
  registerSyncIpc({ driver, keyStore });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
