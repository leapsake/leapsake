// @vitest-environment jsdom
import { resolveReminderSchedule } from "@leapsake/schema";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMilestoneForm } from "../src/headless/index.js";

afterEach(cleanup);

describe("useMilestoneForm", () => {
  it("opens on the requested kind, and submits with no date", () => {
    const { result } = renderHook(() =>
      useMilestoneForm({ bearerType: "person", kind: "death" }),
    );

    expect(result.current.fields.kind).toBe("death");
    expect(result.current.submit()).toEqual({
      ok: true,
      input: {
        kind: "death",
        year: null,
        month: null,
        day: null,
        note: null,
        asksEachYear: true,
      },
    });
  });

  it("cannot submit a day with no month", () => {
    const { result } = renderHook(() =>
      useMilestoneForm({ bearerType: "pet" }),
    );

    act(() => result.current.set("day", "9"));
    expect(result.current.errors).toEqual({ date: "dayWithoutMonth" });
    expect(result.current.submit()).toBeNull();
    act(() => result.current.set("month", "3"));
    expect(result.current.canSubmit).toBe(true);
  });

  it("re-seeds the schedule on a kind change until the user edits it", () => {
    const { result } = renderHook(() =>
      useMilestoneForm({ bearerType: "person" }),
    );

    act(() => result.current.setKind("death"));
    expect(result.current.fields.reminderSchedule).toEqual(
      resolveReminderSchedule("death", []).rules,
    );
    act(() => result.current.setSchedule([]));
    act(() => result.current.setKind("birthday"));
    expect(result.current.fields.reminderSchedule).toEqual([]);
  });

  it("starts from the milestone being edited and its stored schedule", () => {
    const { result } = renderHook(() =>
      useMilestoneForm({
        bearerType: "person",
        milestone: { kind: "other", year: 1945, month: 12, day: 24, note: "" },
        reminderSchedule: [],
      }),
    );

    expect(result.current.fields).toMatchObject({
      kind: "other",
      month: "12",
      day: "24",
      year: "1945",
      reminderSchedule: [],
    });
    expect(result.current.errors).toEqual({ note: "required" });
  });
});
