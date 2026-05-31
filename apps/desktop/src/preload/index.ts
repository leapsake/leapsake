import type {
  CreatePersonInput,
  Person,
  UpdatePersonInput,
} from "@leapsake/schema";
import { contextBridge, ipcRenderer } from "electron";

/**
 * The single typed surface exposed to the renderer as `window.api`. Each method
 * is a thin `ipcRenderer.invoke` wrapper; the renderer never touches SQLite or
 * Node directly. `Api` is exported so the renderer derives its types from here.
 */
const api = {
  people: {
    list: (): Promise<Person[]> => ipcRenderer.invoke("people:list"),
    get: (id: string): Promise<Person | undefined> =>
      ipcRenderer.invoke("people:get", id),
    create: (input: CreatePersonInput): Promise<Person> =>
      ipcRenderer.invoke("people:create", input),
    update: (
      id: string,
      input: UpdatePersonInput,
    ): Promise<Person | undefined> =>
      ipcRenderer.invoke("people:update", id, input),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("people:softDelete", id),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
