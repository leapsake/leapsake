import type {
  CreatePersonInput,
  CreatePetInput,
  CreateRelationshipInput,
  EntityType,
  Gender,
  Person,
  Pet,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  Tag,
  UpdatePersonInput,
  UpdatePetInput,
  UpdateRelationshipInput,
} from "@leapsake/schema";
import { contextBridge, ipcRenderer } from "electron";

/** A gender read returned by the kinship engine: value + whether it was inferred. */
export interface GenderResult {
  value: Gender | null;
  origin: "explicit" | "derived";
}

/**
 * The single typed surface exposed to the renderer as `window.api`. Each method
 * is a thin `ipcRenderer.invoke` wrapper; the renderer never touches SQLite or
 * Node directly. `Api` is exported so the renderer derives its types from here.
 *
 * A Person's or Pet's tags are saved alongside it (the create/update calls carry
 * the full desired tag-name list), so they commit in the same transaction as the
 * entity itself.
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
  pets: {
    list: (): Promise<Pet[]> => ipcRenderer.invoke("pets:list"),
    get: (id: string): Promise<Pet | undefined> =>
      ipcRenderer.invoke("pets:get", id),
    create: (input: CreatePetInput, tagNames: string[]): Promise<Pet> =>
      ipcRenderer.invoke("pets:create", input, tagNames),
    update: (
      id: string,
      input: UpdatePetInput,
      tagNames: string[],
    ): Promise<Pet | undefined> =>
      ipcRenderer.invoke("pets:update", id, input, tagNames),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("pets:softDelete", id),
  },
  tags: {
    get: (id: string): Promise<Tag | undefined> =>
      ipcRenderer.invoke("tags:get", id),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("tags:softDelete", id),
    listForPerson: (personId: string): Promise<Tag[]> =>
      ipcRenderer.invoke("tags:listForPerson", personId),
    listForPet: (petId: string): Promise<Tag[]> =>
      ipcRenderer.invoke("tags:listForPet", petId),
    peopleForTag: (tagId: string): Promise<Person[]> =>
      ipcRenderer.invoke("tags:peopleForTag", tagId),
    petsForTag: (tagId: string): Promise<Pet[]> =>
      ipcRenderer.invoke("tags:petsForTag", tagId),
  },
  relationships: {
    get: (id: string): Promise<Relationship | undefined> =>
      ipcRenderer.invoke("relationships:get", id),
    create: (input: CreateRelationshipInput): Promise<Relationship> =>
      ipcRenderer.invoke("relationships:create", input),
    update: (
      id: string,
      input: UpdateRelationshipInput,
    ): Promise<Relationship | undefined> =>
      ipcRenderer.invoke("relationships:update", id, input),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("relationships:softDelete", id),
    listForEntity: (
      type: EntityType,
      id: string,
    ): Promise<RelationshipNeighbor[]> =>
      ipcRenderer.invoke("relationships:listForEntity", type, id),
  },
  kinship: {
    neighborsFor: (
      type: EntityType,
      id: string,
    ): Promise<RelationshipNeighbor[]> =>
      ipcRenderer.invoke("kinship:neighborsFor", type, id),
    genderFor: (type: EntityType, id: string): Promise<GenderResult> =>
      ipcRenderer.invoke("kinship:genderFor", type, id),
    dismiss: (
      subjectType: EntityType,
      subjectId: string,
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole | null,
    ): Promise<void> =>
      ipcRenderer.invoke(
        "kinship:dismiss",
        subjectType,
        subjectId,
        otherType,
        otherId,
        role,
      ),
    undismiss: (id: string): Promise<void> =>
      ipcRenderer.invoke("kinship:undismiss", id),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
