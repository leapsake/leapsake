import { describe, expect, it } from "vitest";
import {
  type Reminder,
  createReminderInputSchema,
  isReminderEditable,
  reminderDraftOf,
  reminderHasHistory,
  reminderInputOf,
  reminderLabel,
  reminderSchema,
} from "./reminder.js";
import { dueDateMs } from "./reminder-schedule.js";

const base = {
  id: crypto.randomUUID(),
  completedAt: null,
  dueDate: null,
  snoozedUntil: null,
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
    title: "🙋 Tell us about yourself",
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

describe("a reminder draft", () => {
  // Local noon on 24 September 2026, so "today" is the same civil day in any zone.
  const NOW = new Date(2026, 8, 24, 12).getTime();
  const blank = reminderDraftOf(undefined, NOW);
  const due = (month: string, day: string, year: string) => ({
    month,
    day,
    year,
  });

  it("opens blank, due this year once a month and day are typed", () => {
    expect(blank).toEqual({ title: "", body: "", due: due("", "", "2026") });
  });

  it("opens a saved reminder as it was saved", () => {
    const dueDate = dueDateMs({ year: 2026, month: 8, day: 1 });
    expect(
      reminderDraftOf({ title: "Call", body: null, dueDate }, NOW),
    ).toEqual({ title: "Call", body: "", due: due("8", "1", "2026") });
  });

  it("trims the text to null, and turns the due date into the stored day", () => {
    expect(
      reminderInputOf(
        { title: "  ", body: " Call George ", due: due("10", "5", "2026") },
        null,
        NOW,
      ),
    ).toEqual({
      ok: true,
      input: {
        title: null,
        body: "Call George",
        dueDate: dueDateMs({ year: 2026, month: 10, day: 5 }),
      },
    });
  });

  it("needs a title or details", () => {
    expect(reminderInputOf(blank, null, NOW)).toEqual({
      ok: false,
      errors: { title: "required" },
    });
  });

  it("names every problem at once", () => {
    expect(
      reminderInputOf({ ...blank, due: due("9", "23", "2026") }, null, NOW),
    ).toEqual({ ok: false, errors: { title: "required", due: "past" } });
    expect(
      reminderInputOf(
        { ...blank, title: "Call", due: due("2", "31", "2027") },
        null,
        NOW,
      ),
    ).toEqual({ ok: false, errors: { due: "invalid" } });
  });

  it("keeps a past due date that was already saved", () => {
    const saved = dueDateMs({ year: 2026, month: 8, day: 1 });
    expect(
      reminderInputOf(
        { ...blank, title: "Call", due: due("8", "1", "2026") },
        saved,
        NOW,
      ).ok,
    ).toBe(true);
  });
});
