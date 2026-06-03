import type {
  CreatePersonInput,
  Person,
  Tag,
  UpdatePersonInput,
} from "@leapsake/schema";
import { contextBridge, ipcRenderer } from "electron";

/**
 * The single typed surface exposed to the renderer as `window.api`. Each method
 * is a thin `ipcRenderer.invoke` wrapper; the renderer never touches SQLite or
 * Node directly. `Api` is exported so the renderer derives its types from here.
 *
 * A Person's tags are saved alongside it (the create/update calls carry the full
 * desired tag-name list), so they commit in the same transaction as the person.
 */
const api = {
  people: {
    list: (): Promise<Person[]> => ipcRenderer.invoke("people:list"),
    get: (id: string): Promise<Person | undefined> =>
      ipcRenderer.invoke("people:get", id),
    create: (input: CreatePersonInput, tagNames: string[]): Promise<Person> =>
      ipcRenderer.invoke("people:create", input, tagNames),
    update: (
      id: string,
      input: UpdatePersonInput,
      tagNames: string[],
    ): Promise<Person | undefined> =>
      ipcRenderer.invoke("people:update", id, input, tagNames),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("people:softDelete", id),
  },
  tags: {
    get: (id: string): Promise<Tag | undefined> =>
      ipcRenderer.invoke("tags:get", id),
    listForPerson: (personId: string): Promise<Tag[]> =>
      ipcRenderer.invoke("tags:listForPerson", personId),
    peopleForTag: (tagId: string): Promise<Person[]> =>
      ipcRenderer.invoke("tags:peopleForTag", tagId),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
