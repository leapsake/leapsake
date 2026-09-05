import { createCore, runMigrations, withSyncKick } from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * `withSyncKick` is how a local write triggers a sync without every call site
 * remembering to. The behavioural tests use a fake core (the wrapper is purely
 * structural); the *pin* test walks the real `CoreApi` so a new write method
 * can't silently bypass background sync — if the surface grows, the expected
 * mutating set below must be updated consciously.
 */
describe("withSyncKick — kick after mutations", () => {
  it("kicks once after a mutating method resolves, not before", async () => {
    const kick = vi.fn();
    let resolveCreate!: (value: unknown) => void;
    const core = {
      people: {
        create: () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
        list: async () => [],
      },
    };
    const wrapped = withSyncKick(core, kick);

    const pending = wrapped.people.create();
    expect(kick).not.toHaveBeenCalled(); // not until the write lands

    resolveCreate({ id: "1" });
    await pending;
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("does not kick for read methods", async () => {
    const kick = vi.fn();
    const wrapped = withSyncKick(
      { people: { list: async () => [], get: async () => undefined } },
      kick,
    );
    await wrapped.people.list();
    await wrapped.people.get();
    expect(kick).not.toHaveBeenCalled();
  });

  it("kicks for mutations nested under groups (contactMethods.emails)", async () => {
    const kick = vi.fn();
    const wrapped = withSyncKick(
      {
        contactMethods: {
          listForOwner: async () => [],
          emails: { create: async () => ({}) },
        },
        kinship: { dismiss: async () => {}, undismiss: async () => {} },
      },
      kick,
    );

    await wrapped.contactMethods.listForOwner();
    expect(kick).not.toHaveBeenCalled();

    await wrapped.contactMethods.emails.create();
    await wrapped.kinship.dismiss();
    await wrapped.kinship.undismiss();
    expect(kick).toHaveBeenCalledTimes(3);
  });

  it("does not kick when a mutation rejects", async () => {
    const kick = vi.fn();
    const wrapped = withSyncKick(
      {
        people: {
          create: async () => {
            throw new Error("boom");
          },
        },
      },
      kick,
    );
    await expect(wrapped.people.create()).rejects.toThrow("boom");
    expect(kick).not.toHaveBeenCalled();
  });
});

// Mirror of the predicate in sync-scheduler.ts; kept here so this test fails
// loudly if the source predicate and the real surface ever diverge.
const isMutating = (name: string) =>
  /^(create|update|edit|softDelete|merge|dismiss|undismiss|reject|set|clear|snooze|capture|commit|regenerate)/.test(
    name,
  );

function collectFnPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) =>
        collectFnPaths(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [];
}

/**
 * **Every** method on the `CoreApi`, each classified by hand as a `read` or a
 * `write` — a write being any call that changes stored state and therefore needs
 * to reach the user's other devices.
 *
 * The whole surface is listed, not just the writes, and that is the point. This
 * file used to pin only the *output* of {@link isMutating}, which could never
 * catch the bug it existed to catch: filtering the surface through the predicate
 * under test means a write the predicate does not match is simply absent from
 * both sides of the comparison. Nine real writes sat unsynced behind a green
 * test that way — `import.commit`, `people.merge`, `duplicates.reject`,
 * `self.set`/`self.clear`, the three `holidays.set*`, and
 * `reminders.regenerateSystem`.
 *
 * Listing the surface inverts that: a method added to core is missing from this
 * map, so the test fails until somebody says which it is — and if they say
 * `write`, the second assertion fails too unless the predicate actually matches
 * it. Neither failure can be satisfied without a deliberate decision.
 */
const SURFACE: Record<string, "read" | "write"> = {
  "contactMethods.emails.create": "write",
  "contactMethods.emails.softDelete": "write",
  "contactMethods.emails.update": "write",
  "contactMethods.listForOwner": "read",
  "contactMethods.phones.create": "write",
  "contactMethods.phones.softDelete": "write",
  "contactMethods.phones.update": "write",
  "contactMethods.postals.create": "write",
  "contactMethods.postals.softDelete": "write",
  "contactMethods.postals.update": "write",
  "contactMethods.socials.create": "write",
  "contactMethods.socials.softDelete": "write",
  "contactMethods.socials.update": "write",
  "duplicates.count": "read",
  "duplicates.findCandidates": "read",
  "duplicates.findFor": "read",
  "duplicates.nudgeId": "read",
  "duplicates.reject": "write",
  "gifts.capture": "write",
  "gifts.ideas.create": "write",
  "gifts.ideas.get": "read",
  "gifts.ideas.list": "read",
  "gifts.ideas.softDelete": "write",
  "gifts.ideas.update": "write",
  "gifts.overview": "read",
  "gifts.recipients.create": "write",
  "gifts.recipients.listForIdea": "read",
  "gifts.recipients.listForRecipient": "read",
  "gifts.recipients.softDelete": "write",
  "gifts.recipients.update": "write",
  "holidays.get": "read",
  "holidays.getObservanceSchedule": "read",
  "holidays.list": "read",
  "holidays.listForBearer": "read",
  "holidays.listObservers": "read",
  "holidays.occurrencesIn": "read",
  "holidays.setHidden": "write",
  "holidays.setObservanceSchedule": "write",
  "holidays.setObservers": "write",
  "import.commit": "write",
  "import.preview": "read",
  "kinship.dismiss": "write",
  "kinship.genderFor": "read",
  "kinship.neighborsFor": "read",
  "kinship.undismiss": "write",
  "milestones.create": "write",
  "milestones.listForBearer": "read",
  "milestones.reminderSchedule": "read",
  "milestones.softDelete": "write",
  "milestones.timelineFor": "read",
  "milestones.update": "write",
  "notificationSettings.get": "read",
  "notificationSettings.list": "read",
  "notificationSettings.setPermissionState": "write",
  "notificationSettings.setPolicy": "write",
  "people.create": "write",
  "people.get": "read",
  "people.list": "read",
  "people.merge": "write",
  "people.softDelete": "write",
  "people.update": "write",
  "pets.create": "write",
  "pets.get": "read",
  "pets.list": "read",
  "pets.softDelete": "write",
  "pets.update": "write",
  "relationships.create": "write",
  "relationships.createFromSubject": "write",
  "relationships.createWithNewOther": "write",
  "relationships.editFromSubject": "write",
  "relationships.get": "read",
  "relationships.listForEntity": "read",
  "relationships.softDelete": "write",
  "relationships.update": "write",
  "reminders.create": "write",
  "reminders.get": "read",
  "reminders.giftTargets": "read",
  "reminders.planTargets": "read",
  "reminders.list": "read",
  "reminders.listInWindow": "read",
  "reminders.listNotifiable": "read",
  "reminders.mentioning": "read",
  "reminders.regenerateSystem": "write",
  "reminders.setCompleted": "write",
  "reminders.snooze": "write",
  "reminders.softDelete": "write",
  "reminders.update": "write",
  "search.query": "read",
  "self.clear": "write",
  "self.get": "read",
  "self.set": "write",
  "tags.get": "read",
  "tags.giftIdeasForTag": "read",
  "tags.list": "read",
  "tags.listForGiftIdea": "read",
  "tags.listForPerson": "read",
  "tags.listForPet": "read",
  "tags.peopleForTag": "read",
  "tags.petsForTag": "read",
  "tags.remindersForTag": "read",
  "tags.softDelete": "write",
  "views.candidates": "read",
  "views.derivedRelationship": "read",
  "views.entityList": "read",
  "views.milestoneBearer": "read",
  "views.milestoneNew": "read",
  "views.person": "read",
  "views.pet": "read",
  "views.relationship": "read",
  "views.relationshipForSubject": "read",
  "views.relationshipNew": "read",
  "views.relationshipPartners": "read",
};

describe("withSyncKick — pins the CoreApi mutating surface", () => {
  let core: ReturnType<typeof createCore>;
  let cleanup: () => void;

  beforeEach(async () => {
    const bundle = makeEncryptedTestDriver();
    cleanup = bundle.cleanup;
    await runMigrations(bundle.driver);
    core = createCore(bundle.driver);
  });

  afterEach(() => {
    cleanup();
  });

  it("classifies every method on the surface", () => {
    // Fails on a net-new method, a removed one, or a rename. The fix is to
    // classify it in SURFACE — which is the moment somebody has to decide
    // whether it writes.
    expect(collectFnPaths(core).sort()).toEqual(Object.keys(SURFACE).sort());
  });

  it("matches the predicate to every method classified as a write", () => {
    const misclassified = Object.entries(SURFACE)
      .filter(
        ([path, kind]) =>
          isMutating(path.split(".").at(-1) ?? "") !== (kind === "write"),
      )
      .map(
        ([path, kind]) => `${path} is a ${kind} the predicate disagrees with`,
      )
      .sort();

    expect(misclassified).toEqual([]);
  });
});
