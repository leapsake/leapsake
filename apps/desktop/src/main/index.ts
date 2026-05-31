import { join } from "node:path";
import {
  type PeopleRepo,
  createPeopleRepo,
  runMigrations,
} from "@leapsake/data";
import {
  createPersonInputSchema,
  updatePersonInputSchema,
} from "@leapsake/schema";
import Database from "better-sqlite3";
import { BrowserWindow, app, ipcMain } from "electron";
import { betterSqlite3Driver } from "./db/better-sqlite3-driver.js";

/**
 * Register the typed IPC surface. Inputs cross a trust boundary, so they are
 * validated with the Zod schemas before reaching the repository (which also
 * validates internally — cheap belt-and-suspenders at the boundary).
 */
function registerIpc(people: PeopleRepo): void {
  ipcMain.handle("people:list", () => people.list());
  ipcMain.handle("people:get", (_event, id: string) => people.get(id));
  ipcMain.handle("people:create", (_event, input: unknown) =>
    people.create(createPersonInputSchema.parse(input)),
  );
  ipcMain.handle("people:update", (_event, id: string, input: unknown) =>
    people.update(id, updatePersonInputSchema.parse(input)),
  );
  ipcMain.handle("people:softDelete", (_event, id: string) =>
    people.softDelete(id),
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
  const db = new Database(join(app.getPath("userData"), "leapsake.db"));
  const driver = betterSqlite3Driver(db);
  await runMigrations(driver);
  registerIpc(createPeopleRepo(driver));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
