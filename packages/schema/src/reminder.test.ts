import { describe, expect, it } from "vitest";
import {
  createReminderInputSchema,
  reminderLabel,
  reminderSchema,
} from "./reminder.js";

const base = {
  id: crypto.randomUUID(),
  completedAt: null,
  dueDate: null,
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
