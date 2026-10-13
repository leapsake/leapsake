import { describe, expect, it } from "vitest";
import { isGroupOn, withGroup } from "./notification-groups";

describe("notification groups", () => {
  it("counts My reminders on only when both its categories are", () => {
    expect(isGroupOn(["custom", "occasion"], "mine")).toBe(true);
    expect(isGroupOn(["custom"], "mine")).toBe(false);
  });

  it("turns Leapsake to-dos on without touching My reminders", () => {
    expect(withGroup(["custom", "occasion"], "todos", true)).toEqual([
      "custom",
      "occasion",
      "todo",
    ]);
  });

  it("turns My reminders off, leaving to-dos on", () => {
    expect(withGroup(["custom", "occasion", "todo"], "mine", false)).toEqual([
      "todo",
    ]);
  });

  it("completes a group that was partly on", () => {
    expect(isGroupOn(withGroup(["occasion"], "mine", true), "mine")).toBe(true);
  });
});
