import { join } from "node:path";
import {
  type ContactMethodsRepo,
  type DismissalsRepo,
  type KinshipService,
  type MilestonesRepo,
  type PeopleRepo,
  type PetsRepo,
  type RelationshipsRepo,
  type SearchService,
  type SqliteDriver,
  type TagsRepo,
  createContactMethodsRepo,
  createDismissalsRepo,
  createKinshipService,
  createMilestonesRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createSearchService,
  createTagsRepo,
  listContactMethods,
  listTimelineForEntity,
  runMigrations,
} from "@leapsake/data";
import {
  type ContactOwnerType,
  type EntityType,
  type MilestoneSubjectType,
  type Person,
  type Pet,
  type RelationshipNeighbor,
  type RelationshipRole,
  createEmailInputSchema,
  createMilestoneInputSchema,
  createPersonInputSchema,
  createPetInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  createRelationshipInputSchema,
  roleDefs,
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

/** Coerce IPC-supplied tag names to a clean `string[]` before the repo dedupes. */
function asTagNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Register the typed IPC surface. Inputs cross a trust boundary, so they are
 * validated with the Zod schemas before reaching the repository (which also
 * validates internally — cheap belt-and-suspenders at the boundary). A Person's
 * or Pet's write and its tag changes are composed in a single `driver.transaction`
 * so a partial failure rolls back both.
 */
function registerIpc(
  driver: SqliteDriver,
  people: PeopleRepo,
  pets: PetsRepo,
  tags: TagsRepo,
  relationships: RelationshipsRepo,
  dismissals: DismissalsRepo,
  kinship: KinshipService,
  milestones: MilestonesRepo,
  contactMethods: ContactMethodsRepo,
  search: SearchService,
): void {
  // Resolve an entity to its display label for relationship rows. The label is
  // composed inline here because the main process can't import renderer helpers.
  async function resolveLabel(
    type: EntityType,
    id: string,
  ): Promise<string | undefined> {
    if (type === "person") {
      const person = await people.get(id);
      return person ? `${person.firstName} ${person.lastName}` : undefined;
    }
    const pet = await pets.get(id);
    return pet ? pet.name : undefined;
  }

  ipcMain.handle("people:list", () => people.list());
  ipcMain.handle("people:get", (_event, id: string) => people.get(id));
  ipcMain.handle("people:create", (_event, input: unknown, tagNames: unknown) =>
    driver.transaction(async () => {
      const person = await people.create(createPersonInputSchema.parse(input));
      await tags.setEntityTags("person", person.id, asTagNames(tagNames));
      return person;
    }),
  );
  ipcMain.handle(
    "people:update",
    (_event, id: string, input: unknown, tagNames: unknown) =>
      driver.transaction(async () => {
        const person = await people.update(
          id,
          updatePersonInputSchema.parse(input),
        );
        if (person) {
          await tags.setEntityTags("person", id, asTagNames(tagNames));
        }
        return person;
      }),
  );
  ipcMain.handle("people:softDelete", (_event, id: string) =>
    driver.transaction(async () => {
      await people.softDelete(id);
      await tags.removeAllForEntity("person", id);
      await relationships.removeAllForEntity("person", id);
      await dismissals.removeAllForEntity("person", id);
      await milestones.removeAllForEntity("person", id);
      await contactMethods.removeAllForOwner("person", id);
    }),
  );

  ipcMain.handle("pets:list", () => pets.list());
  ipcMain.handle("pets:get", (_event, id: string) => pets.get(id));
  ipcMain.handle("pets:create", (_event, input: unknown, tagNames: unknown) =>
    driver.transaction(async () => {
      const pet = await pets.create(createPetInputSchema.parse(input));
      await tags.setEntityTags("pet", pet.id, asTagNames(tagNames));
      return pet;
    }),
  );
  ipcMain.handle(
    "pets:update",
    (_event, id: string, input: unknown, tagNames: unknown) =>
      driver.transaction(async () => {
        const pet = await pets.update(id, updatePetInputSchema.parse(input));
        if (pet) {
          await tags.setEntityTags("pet", id, asTagNames(tagNames));
        }
        return pet;
      }),
  );
  ipcMain.handle("pets:softDelete", (_event, id: string) =>
    driver.transaction(async () => {
      await pets.softDelete(id);
      await tags.removeAllForEntity("pet", id);
      await relationships.removeAllForEntity("pet", id);
      await dismissals.removeAllForEntity("pet", id);
      await milestones.removeAllForEntity("pet", id);
    }),
  );

  ipcMain.handle("relationships:get", (_event, id: string) =>
    relationships.get(id),
  );
  ipcMain.handle("relationships:create", (_event, input: unknown) =>
    driver.transaction(() =>
      relationships.create(createRelationshipInputSchema.parse(input)),
    ),
  );
  ipcMain.handle("relationships:update", (_event, id: string, input: unknown) =>
    driver.transaction(() =>
      relationships.update(id, updateRelationshipInputSchema.parse(input)),
    ),
  );
  ipcMain.handle("relationships:softDelete", (_event, id: string) =>
    driver.transaction(() => relationships.softDelete(id)),
  );
  // Compose the per-entity view: orient each stored row to the subject and
  // resolve the *other* end's label + role so the renderer never sees a/b.
  ipcMain.handle(
    "relationships:listForEntity",
    async (_event, type: EntityType, id: string) => {
      const rows = await relationships.listForEntity(type, id);
      const neighbors: RelationshipNeighbor[] = [];
      for (const rel of rows) {
        const subjectIsA = rel.aType === type && rel.aId === id;
        const otherType = subjectIsA ? rel.bType : rel.aType;
        const otherId = subjectIsA ? rel.bId : rel.aId;
        const otherRole = subjectIsA ? rel.bRole : rel.aRole;
        const otherRoleNote = subjectIsA ? rel.bRoleNote : rel.aRoleNote;
        const otherLabel = await resolveLabel(otherType, otherId);
        if (otherLabel === undefined) continue; // other end gone — skip
        neighbors.push({
          relationshipId: rel.id,
          otherType,
          otherId,
          otherLabel,
          otherRole,
          otherRoleLabel: roleDefs[otherRole].label,
          otherRoleNote,
          origin: "explicit",
        });
      }
      return neighbors;
    },
  );

  ipcMain.handle(
    "milestones:listForSubject",
    (_event, type: MilestoneSubjectType, id: string) =>
      milestones.listForSubject(type, id),
  );
  // The merged timeline for a Person/Pet: own milestones plus the milestones of
  // each explicit relationship it's in, resolved read-only via a 1-hop join. The
  // composition lives in @leapsake/data; we pass our label resolver so it can
  // annotate each relationship entry with the other partner's name.
  ipcMain.handle(
    "milestones:timelineFor",
    (_event, type: EntityType, id: string) =>
      listTimelineForEntity(milestones, relationships, resolveLabel, type, id),
  );
  ipcMain.handle("milestones:create", (_event, input: unknown) =>
    driver.transaction(() =>
      milestones.create(createMilestoneInputSchema.parse(input)),
    ),
  );
  ipcMain.handle("milestones:update", (_event, id: string, input: unknown) =>
    driver.transaction(() =>
      milestones.update(id, updateMilestoneInputSchema.parse(input)),
    ),
  );
  ipcMain.handle("milestones:softDelete", (_event, id: string) =>
    driver.transaction(() => milestones.softDelete(id)),
  );

  // Contact methods: the merged read fans out across the three typed tables in
  // @leapsake/data; writes target one typed sub-repo each. Inputs are
  // Zod-validated at this trust boundary (the repo validates again internally).
  ipcMain.handle(
    "contactMethods:listForOwner",
    (_event, type: ContactOwnerType, id: string) =>
      listContactMethods(contactMethods, { type, id }),
  );
  ipcMain.handle("contactMethods:emails:create", (_event, input: unknown) =>
    driver.transaction(() =>
      contactMethods.emails.create(createEmailInputSchema.parse(input)),
    ),
  );
  ipcMain.handle(
    "contactMethods:emails:update",
    (_event, id: string, input: unknown) =>
      driver.transaction(() =>
        contactMethods.emails.update(id, updateEmailInputSchema.parse(input)),
      ),
  );
  ipcMain.handle("contactMethods:emails:softDelete", (_event, id: string) =>
    driver.transaction(() => contactMethods.emails.softDelete(id)),
  );
  ipcMain.handle("contactMethods:phones:create", (_event, input: unknown) =>
    driver.transaction(() =>
      contactMethods.phones.create(createPhoneInputSchema.parse(input)),
    ),
  );
  ipcMain.handle(
    "contactMethods:phones:update",
    (_event, id: string, input: unknown) =>
      driver.transaction(() =>
        contactMethods.phones.update(id, updatePhoneInputSchema.parse(input)),
      ),
  );
  ipcMain.handle("contactMethods:phones:softDelete", (_event, id: string) =>
    driver.transaction(() => contactMethods.phones.softDelete(id)),
  );
  ipcMain.handle("contactMethods:postals:create", (_event, input: unknown) =>
    driver.transaction(() =>
      contactMethods.postals.create(createPostalInputSchema.parse(input)),
    ),
  );
  ipcMain.handle(
    "contactMethods:postals:update",
    (_event, id: string, input: unknown) =>
      driver.transaction(() =>
        contactMethods.postals.update(id, updatePostalInputSchema.parse(input)),
      ),
  );
  ipcMain.handle("contactMethods:postals:softDelete", (_event, id: string) =>
    driver.transaction(() => contactMethods.postals.softDelete(id)),
  );

  // Kinship inference: compute-on-read derived gender + neighbors, and the
  // dismiss/undismiss mutations that suppress a rejected derived edge.
  ipcMain.handle(
    "kinship:neighborsFor",
    (_event, type: EntityType, id: string) => kinship.neighborsFor(type, id),
  );
  ipcMain.handle("kinship:genderFor", (_event, type: EntityType, id: string) =>
    kinship.genderFor(type, id),
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
    ) =>
      driver.transaction(() =>
        dismissals.create(
          { type: subjectType, id: subjectId },
          { type: otherType, id: otherId },
          role,
        ),
      ),
  );
  ipcMain.handle("kinship:undismiss", (_event, id: string) =>
    driver.transaction(() => dismissals.softDelete(id)),
  );

  ipcMain.handle("tags:get", (_event, id: string) => tags.get(id));
  ipcMain.handle("tags:softDelete", (_event, id: string) =>
    driver.transaction(() => tags.softDelete(id)),
  );
  ipcMain.handle("tags:listForPerson", (_event, personId: string) =>
    tags.listForEntity("person", personId),
  );
  ipcMain.handle("tags:listForPet", (_event, petId: string) =>
    tags.listForEntity("pet", petId),
  );
  ipcMain.handle("tags:peopleForTag", async (_event, tagId: string) => {
    const ids = await tags.entityIdsForTag(tagId, "person");
    const found = await Promise.all(ids.map((id) => people.get(id)));
    return found.filter((p): p is Person => p !== undefined);
  });
  ipcMain.handle("tags:petsForTag", async (_event, tagId: string) => {
    const ids = await tags.entityIdsForTag(tagId, "pet");
    const found = await Promise.all(ids.map((id) => pets.get(id)));
    return found.filter((p): p is Pet => p !== undefined);
  });

  // Read-only global search. Non-string input from the boundary is coerced to an
  // empty query, which the service short-circuits to no results.
  ipcMain.handle("search:query", (_event, term: unknown) =>
    search.query(typeof term === "string" ? term : ""),
  );
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
  const people = createPeopleRepo(driver);
  const pets = createPetsRepo(driver);
  const relationships = createRelationshipsRepo(driver);
  const dismissals = createDismissalsRepo(driver);
  const milestones = createMilestonesRepo(driver);
  const contactMethods = createContactMethodsRepo(driver);
  const kinship = createKinshipService(driver, {
    people,
    pets,
    relationships,
    dismissals,
  });
  const search = createSearchService(driver);
  registerIpc(
    driver,
    people,
    pets,
    createTagsRepo(driver),
    relationships,
    dismissals,
    kinship,
    milestones,
    contactMethods,
    search,
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
