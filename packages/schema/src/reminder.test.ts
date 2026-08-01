import { describe, expect, it } from "vitest";
import {
  type Reminder,
  createReminderInputSchema,
  isReminderEditable,
  reminderHasHistory,
  reminderLabel,
  reminderSchema,
} from "./reminder.js";

const base = {
  id: crypto.randomUUID(),
  completedAt: null,
  dueDate: null,
  snoozedUntil: null,
  snoozeCount: 0,
  source: "user" as const,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

describe("reminderSchema", () => {
  it("requires at least one of title/body", () => {
    expect(
      reminderSchema.safeParse({ ...base, title: "Call mom", body: null })
        .success,
    ).toBe(true);
    expect(
      reminderSchema.safeParse({ ...base, title: null, body: "buy milk" })
        .success,
    ).toBe(true);
    expect(
      reminderSchema.safeParse({ ...base, title: null, body: null }).success,
    ).toBe(false);
  });

  it("rejects an empty-string title or body (min length 1)", () => {
    expect(
      reminderSchema.safeParse({ ...base, title: "", body: "ok" }).success,
    ).toBe(false);
  });
});

describe("createReminderInputSchema", () => {
  it("defaults source to undefined (repo applies 'user') and needs some text", () => {
    const parsed = createReminderInputSchema.parse({ title: "Call mom" });
    expect(parsed.source).toBeUndefined();
    expect(createReminderInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an explicit system source", () => {
    expect(
      createReminderInputSchema.parse({ body: "birthday", source: "system" })
        .source,
    ).toBe("system");
  });
});

describe("isReminderEditable", () => {
  it("is true for a user reminder and false for an automatic one", () => {
    expect(isReminderEditable({ source: "user" })).toBe(true);
    expect(isReminderEditable({ source: "system" })).toBe(false);
  });
});

describe("reminderHasHistory", () => {
  /** A nudge exactly as `reconcile` mints it — the row that must lose a merge. */
  const minted = (over: Partial<Reminder> = {}): Reminder => ({
    ...base,
    title: "🙋 Which of these is you? Pick yourself.",
    body: null,
    source: "system",
    ...over,
  });

  it("is false for a system row exactly as the engine minted it", () => {
    expect(reminderHasHistory(minted())).toBe(false);
  });

  it("is false after an engine title/dueDate refresh — no decision was taken", () => {
    // The case no timestamp test can tell apart from a user's act, and the
    // reason this is a per-table predicate.
    expect(
      reminderHasHistory(
        minted({ title: "🙋 renamed by the engine", updatedAt: 9000 }),
      ),
    ).toBe(false);
    expect(reminderHasHistory(minted({ dueDate: 123, updatedAt: 9000 }))).toBe(
      false,
    );
  });

  it("is true once someone has decided something about the row", () => {
    expect(reminderHasHistory(minted({ snoozedUntil: 123 }))).toBe(true);
    // The count outlives the clock: a spent snooze is still history.
    expect(reminderHasHistory(minted({ snoozeCount: 1 }))).toBe(true);
    expect(reminderHasHistory(minted({ completedAt: 123 }))).toBe(true);
    expect(reminderHasHistory(minted({ deletedAt: 123 }))).toBe(true);
  });

  it("is true for any user reminder — nothing minted it", () => {
    expect(reminderHasHistory({ ...base, title: "Call mom", body: null })).toBe(
      true,
    );
  });
});

describe("reminderLabel", () => {
  it("prefers the title, then the first body line, then a placeholder", () => {
    expect(reminderLabel({ title: "Call mom", body: "later" })).toBe(
      "Call mom",
    );
    expect(reminderLabel({ title: null, body: "buy milk\nand eggs" })).toBe(
      "buy milk",
    );
    expect(reminderLabel({ title: null, body: null })).toBe(
      "Untitled reminder",
    );
  });
});
