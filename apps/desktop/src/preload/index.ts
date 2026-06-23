import type {
  CoreApi,
  DerivedRelationshipView,
  DuplicateCandidate,
  EntityRow,
  GenderResult,
  MilestoneNewView,
  MilestoneSubject,
  PersonView,
  PetView,
  RelationshipCandidate,
  RelationshipForSubjectView,
  RelationshipNewView,
  RelationshipPartnersView,
  RelationshipView,
  SyncStatus,
} from "@leapsake/core";
import type {
  ContactMethod,
  ContactOwnerType,
  CreateEmailInput,
  CreateMilestoneInput,
  CreatePersonInput,
  CreatePetInput,
  CreatePhoneInput,
  CreatePostalInput,
  CreateRelationshipInput,
  EmailAddress,
  EntityType,
  Milestone,
  MilestoneSubjectType,
  MilestoneTimelineEntry,
  Person,
  Pet,
  PhoneNumber,
  PostalAddress,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  SearchHit,
  Tag,
  UpdateEmailInput,
  UpdateMilestoneInput,
  UpdatePersonInput,
  UpdatePetInput,
  UpdatePhoneInput,
  UpdatePostalInput,
  UpdateRelationshipInput,
} from "@leapsake/schema";
import { contextBridge, ipcRenderer } from "electron";

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
    merge: (survivorId: string, loserId: string): Promise<void> =>
      ipcRenderer.invoke("people:merge", survivorId, loserId),
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
    createFromSubject: (
      input: Parameters<CoreApi["relationships"]["createFromSubject"]>[0],
    ): Promise<Relationship> =>
      ipcRenderer.invoke("relationships:createFromSubject", input),
    editFromSubject: (
      input: Parameters<CoreApi["relationships"]["editFromSubject"]>[0],
    ): Promise<Relationship | undefined> =>
      ipcRenderer.invoke("relationships:editFromSubject", input),
  },
  milestones: {
    listForSubject: (
      type: MilestoneSubjectType,
      id: string,
    ): Promise<Milestone[]> =>
      ipcRenderer.invoke("milestones:listForSubject", type, id),
    timelineFor: (
      type: EntityType,
      id: string,
    ): Promise<MilestoneTimelineEntry[]> =>
      ipcRenderer.invoke("milestones:timelineFor", type, id),
    create: (input: CreateMilestoneInput): Promise<Milestone> =>
      ipcRenderer.invoke("milestones:create", input),
    update: (
      id: string,
      input: UpdateMilestoneInput,
    ): Promise<Milestone | undefined> =>
      ipcRenderer.invoke("milestones:update", id, input),
    softDelete: (id: string): Promise<void> =>
      ipcRenderer.invoke("milestones:softDelete", id),
  },
  contactMethods: {
    listForOwner: (
      type: ContactOwnerType,
      id: string,
    ): Promise<ContactMethod[]> =>
      ipcRenderer.invoke("contactMethods:listForOwner", type, id),
    emails: {
      create: (input: CreateEmailInput): Promise<EmailAddress> =>
        ipcRenderer.invoke("contactMethods:emails:create", input),
      update: (
        id: string,
        input: UpdateEmailInput,
      ): Promise<EmailAddress | undefined> =>
        ipcRenderer.invoke("contactMethods:emails:update", id, input),
      softDelete: (id: string): Promise<void> =>
        ipcRenderer.invoke("contactMethods:emails:softDelete", id),
    },
    phones: {
      create: (input: CreatePhoneInput): Promise<PhoneNumber> =>
        ipcRenderer.invoke("contactMethods:phones:create", input),
      update: (
        id: string,
        input: UpdatePhoneInput,
      ): Promise<PhoneNumber | undefined> =>
        ipcRenderer.invoke("contactMethods:phones:update", id, input),
      softDelete: (id: string): Promise<void> =>
        ipcRenderer.invoke("contactMethods:phones:softDelete", id),
    },
    postals: {
      create: (input: CreatePostalInput): Promise<PostalAddress> =>
        ipcRenderer.invoke("contactMethods:postals:create", input),
      update: (
        id: string,
        input: UpdatePostalInput,
      ): Promise<PostalAddress | undefined> =>
        ipcRenderer.invoke("contactMethods:postals:update", id, input),
      softDelete: (id: string): Promise<void> =>
        ipcRenderer.invoke("contactMethods:postals:softDelete", id),
    },
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
  search: {
    query: (term: string): Promise<SearchHit[]> =>
      ipcRenderer.invoke("search:query", term),
  },
  duplicates: {
    findCandidates: (): Promise<DuplicateCandidate[]> =>
      ipcRenderer.invoke("duplicates:findCandidates"),
    reject: (idA: string, idB: string): Promise<void> =>
      ipcRenderer.invoke("duplicates:reject", idA, idB),
  },
  views: {
    entityList: (): Promise<EntityRow[]> =>
      ipcRenderer.invoke("views:entityList"),
    candidates: (exclude?: {
      type: EntityType;
      id: string;
    }): Promise<RelationshipCandidate[]> =>
      ipcRenderer.invoke("views:candidates", exclude),
    relationshipNew: (
      subjectType: EntityType,
      id: string,
    ): Promise<RelationshipNewView | null> =>
      ipcRenderer.invoke("views:relationshipNew", subjectType, id),
    person: (id: string): Promise<PersonView | null> =>
      ipcRenderer.invoke("views:person", id),
    pet: (id: string): Promise<PetView | null> =>
      ipcRenderer.invoke("views:pet", id),
    relationship: (id: string): Promise<RelationshipView | null> =>
      ipcRenderer.invoke("views:relationship", id),
    relationshipPartners: (
      id: string,
    ): Promise<RelationshipPartnersView | null> =>
      ipcRenderer.invoke("views:relationshipPartners", id),
    relationshipForSubject: (
      subjectType: EntityType,
      id: string,
      relId: string,
    ): Promise<RelationshipForSubjectView | null> =>
      ipcRenderer.invoke(
        "views:relationshipForSubject",
        subjectType,
        id,
        relId,
      ),
    derivedRelationship: (
      subjectType: EntityType,
      id: string,
      otherType: EntityType,
      otherId: string,
      role: RelationshipRole,
    ): Promise<DerivedRelationshipView | null> =>
      ipcRenderer.invoke(
        "views:derivedRelationship",
        subjectType,
        id,
        otherType,
        otherId,
        role,
      ),
    milestoneSubject: (
      subjectType: MilestoneSubjectType,
      id: string,
    ): Promise<MilestoneSubject | undefined> =>
      ipcRenderer.invoke("views:milestoneSubject", subjectType, id),
    milestoneNew: (
      subjectType: MilestoneSubjectType,
      id: string,
    ): Promise<MilestoneNewView | null> =>
      ipcRenderer.invoke("views:milestoneNew", subjectType, id),
  },
} satisfies CoreApi;

contextBridge.exposeInMainWorld("api", api);

/**
 * The sync/account custody surface, exposed as a **separate** `window.sync`
 * bridge rather than folded into `window.api`. Enabling sync is not a
 * {@link CoreApi} operation — it derives a KEK in the main process and touches
 * the OS keystore — so keeping it off the `satisfies CoreApi` surface above
 * stops the IPC contract and core from drifting. `enable` returns the one-time
 * recovery key already base64-encoded for display; the renderer shows it once.
 */
const sync = {
  status: (): Promise<SyncStatus> => ipcRenderer.invoke("sync:status"),
  lookup: (args: {
    username: string;
    relayUrl: string;
  }): Promise<{ exists: boolean }> => ipcRenderer.invoke("sync:lookup", args),
  enable: (args: {
    username: string;
    password: string;
    relayUrl: string;
  }): Promise<{ accountId: string; recoveryKey: string }> =>
    ipcRenderer.invoke("sync:enable", args),
  join: (args: {
    username: string;
    password: string;
    relayUrl: string;
    // `duplicateCount` is how many possible duplicates the join surfaced between
    // this device's pre-existing people and the account's — a prompt to review.
  }): Promise<{ duplicateCount: number }> =>
    ipcRenderer.invoke("sync:join", args),
  recover: (args: {
    username: string;
    recoveryPhrase: string;
    newPassword: string;
    relayUrl: string;
  }): Promise<{ duplicateCount: number }> =>
    ipcRenderer.invoke("sync:recover", args),
  syncNow: (): Promise<{ at: number }> => ipcRenderer.invoke("sync:now"),
  clear: (): Promise<void> => ipcRenderer.invoke("sync:clear"),
  /** Reveal this device's recovery phrase (the words back into the data). */
  revealRecoveryPhrase: (): Promise<string> =>
    ipcRenderer.invoke("sync:revealRecoveryPhrase"),
  /** Read this install's "Sync automatically" preference (default true). */
  getAutoSync: (): Promise<boolean> => ipcRenderer.invoke("sync:getAutoSync"),
  /** Persist + apply the "Sync automatically" preference for this install. */
  setAutoSync: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("sync:setAutoSync", enabled),
  /**
   * Subscribe to background-sync activity (interval / focus / write-kicked runs,
   * not just the manual button), so the renderer can keep its "last synced" line
   * fresh. Returns an unsubscribe function. The payload carries either a
   * completion time or a non-fatal error message, plus `changed` (a pull applied
   * records) so the renderer can revalidate the active route.
   */
  onActivity: (
    listener: (payload: {
      at?: number;
      error?: string;
      changed?: boolean;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { at?: number; error?: string; changed?: boolean },
    ) => listener(payload);
    ipcRenderer.on("sync:activity", handler);
    return () => ipcRenderer.removeListener("sync:activity", handler);
  },
};

contextBridge.exposeInMainWorld("sync", sync);

export type Sync = typeof sync;

/**
 * The **boot gate** bridge: the renderer mounts before the database is open, so
 * it can host the at-rest recovery prompt when this device's enclave key is gone
 * but the encrypted file + recovery sidecar survive (encryption `model.md` §6).
 * `status` is the race-safe initial read (an event may fire before the renderer
 * subscribes); `onRecoveryNeeded` carries the previous attempt's error on a retry;
 * `onReady` fires once the core is fully initialized and the app may render.
 */
const boot = {
  status: (): Promise<{
    phase: "starting" | "recovering" | "ready";
    error?: string;
  }> => ipcRenderer.invoke("boot:status"),
  submitRecoveryPhrase: (phrase: string): Promise<void> =>
    ipcRenderer.invoke("boot:recovery", phrase),
  onRecoveryNeeded: (listener: (error?: string) => void): (() => void) => {
    const handler = (_event: unknown, error?: string) => listener(error);
    ipcRenderer.on("boot:recovery-needed", handler);
    return () => ipcRenderer.removeListener("boot:recovery-needed", handler);
  },
  onReady: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("boot:ready", handler);
    return () => ipcRenderer.removeListener("boot:ready", handler);
  },
};

contextBridge.exposeInMainWorld("boot", boot);

export type Boot = typeof boot;

export type { GenderResult };

// The renderer derives its `window.api` contract from the client-agnostic core
// surface, so the IPC bridge and core can never drift. `api` above is the
// runtime `ipcRenderer.invoke` implementation of this same shape; typecheck
// confirms it satisfies `CoreApi`.
export type Api = CoreApi;
