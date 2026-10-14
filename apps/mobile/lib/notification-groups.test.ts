import { describe, expect, it } from "vitest";
import { isGroupOn, withGroup } from "./notification-groups";

describe("notification groups", () => {
  it("counts My reminders on only when all its categories are", () => {
    expect(isGroupOn(["custom", "occasion", "remembrance"], "mine")).toBe(true);
    expect(isGroupOn(["custom", "occasion"], "mine")).toBe(false);
  });

  it("carries days of remembrance with My reminders", () => {
    expect(withGroup([], "mine", true)).toEqual([
      "custom",
      "occasion",
      "remembrance",
    ]);
  });

  it("turns Leapsake to-dos on without touching My reminders", () => {
    expect(
      withGroup(["custom", "occasion", "remembrance"], "todos", true),
    ).toEqual(["custom", "occasion", "remembrance", "todo"]);
  });

  it("turns My reminders off, leaving to-dos on", () => {
    expect(
      withGroup(["custom", "occasion", "remembrance", "todo"], "mine", false),
    ).toEqual(["todo"]);
  });

  it("completes a group that was partly on", () => {
    expect(isGroupOn(withGroup(["occasion"], "mine", true), "mine")).toBe(true);
  });
});
