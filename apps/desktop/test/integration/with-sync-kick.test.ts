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
  /^(create|update|edit|softDelete|dismiss|undismiss|setCompleted)/.test(name);

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

  it("treats exactly the write methods as mutations", () => {
    const mutating = collectFnPaths(core)
      .filter((path) => isMutating(path.split(".").at(-1) ?? ""))
      .sort();

    expect(mutating).toEqual([
      "contactMethods.emails.create",
      "contactMethods.emails.softDelete",
      "contactMethods.emails.update",
      "contactMethods.phones.create",
      "contactMethods.phones.softDelete",
      "contactMethods.phones.update",
      "contactMethods.postals.create",
      "contactMethods.postals.softDelete",
      "contactMethods.postals.update",
      "gifts.given.create",
      "gifts.given.softDelete",
      "gifts.given.update",
      "gifts.ideas.create",
      "gifts.ideas.softDelete",
      "gifts.ideas.update",
      "gifts.suggestions.create",
      "gifts.suggestions.softDelete",
      "gifts.suggestions.update",
      "kinship.dismiss",
      "kinship.undismiss",
      "milestones.create",
      "milestones.softDelete",
      "milestones.update",
      "people.create",
      "people.softDelete",
      "people.update",
      "pets.create",
      "pets.softDelete",
      "pets.update",
      "relationships.create",
      "relationships.createFromSubject",
      "relationships.editFromSubject",
      "relationships.softDelete",
      "relationships.update",
      "reminders.create",
      "reminders.setCompleted",
      "reminders.softDelete",
      "reminders.update",
      "tags.softDelete",
    ]);
  });
});
