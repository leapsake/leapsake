// @vitest-environment jsdom
import { dueDateMs, todayCivil } from "@leapsake/schema";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useReminderForm } from "../src/headless/index.js";

afterEach(cleanup);

const nextYear = String(todayCivil(Date.now()).year + 1);

describe("useReminderForm", () => {
  it("cannot submit until there is a title or details", () => {
    const { result } = renderHook(() => useReminderForm());

    expect(result.current.canSubmit).toBe(false);
    expect(result.current.errors).toEqual({ title: "required" });
    act(() => result.current.set("body", "Call George"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: { title: null, body: "Call George", dueDate: null },
    });
  });

  it("refuses a day that does not exist", () => {
    const { result } = renderHook(() => useReminderForm());

    act(() => result.current.set("title", "Call"));
    act(() =>
      result.current.set("due", { month: "2", day: "30", year: nextYear }),
    );
    expect(result.current.errors).toEqual({ due: "invalid" });
  });

  it("keeps a past due date that was already saved", () => {
    const dueDate = dueDateMs({ year: 2020, month: 1, day: 1 });
    const { result } = renderHook(() =>
      useReminderForm({ title: "Call", body: null, dueDate }),
    );

    expect(result.current.submit()).toEqual({
      ok: true,
      input: { title: "Call", body: null, dueDate },
    });
  });
});
