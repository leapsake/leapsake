import { join } from "node:path";
import {
  type PeopleRepo,
  type PetsRepo,
  type RelationshipsRepo,
  type SqliteDriver,
  type TagsRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createTagsRepo,
  runMigrations,
} from "@leapsake/data";
import {
  type EntityType,
  type Person,
  type RelationshipNeighbor,
  createPersonInputSchema,
  createPetInputSchema,
  createRelationshipInputSchema,
  roleDefs,
  updatePersonInputSchema,
  updatePetInputSchema,
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
 * validates internally — cheap belt-and-suspenders at the boundary). Person
 * writes and their tag changes are composed in a single `driver.transaction` so
 * a partial failure rolls back both.
 */
function registerIpc(
  driver: SqliteDriver,
  people: PeopleRepo,
  pets: PetsRepo,
  tags: TagsRepo,
  relationships: RelationshipsRepo,
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
    }),
  );

  ipcMain.handle("pets:list", () => pets.list());
  ipcMain.handle("pets:get", (_event, id: string) => pets.get(id));
  ipcMain.handle("pets:create", (_event, input: unknown) =>
    pets.create(createPetInputSchema.parse(input)),
  );
  ipcMain.handle("pets:update", (_event, id: string, input: unknown) =>
    pets.update(id, updatePetInputSchema.parse(input)),
  );
  ipcMain.handle("pets:softDelete", (_event, id: string) =>
    driver.transaction(async () => {
      await pets.softDelete(id);
      await relationships.removeAllForEntity("pet", id);
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
        });
      }
      return neighbors;
    },
  );

  ipcMain.handle("tags:get", (_event, id: string) => tags.get(id));
  ipcMain.handle("tags:listForPerson", (_event, personId: string) =>
    tags.listForEntity("person", personId),
  );
  ipcMain.handle("tags:peopleForTag", async (_event, tagId: string) => {
    const ids = await tags.entityIdsForTag(tagId, "person");
    const found = await Promise.all(ids.map((id) => people.get(id)));
    return found.filter((p): p is Person => p !== undefined);
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
  registerIpc(
    driver,
    createPeopleRepo(driver),
    createPetsRepo(driver),
    createTagsRepo(driver),
    createRelationshipsRepo(driver),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
