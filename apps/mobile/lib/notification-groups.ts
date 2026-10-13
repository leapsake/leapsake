import type { ReminderCategory } from "@leapsake/core";

/** The switches the notifications screen offers, each covering categories. */
export type NotificationGroup = "mine" | "remembrance" | "todos";

export const NOTIFICATION_GROUPS: Record<
  NotificationGroup,
  readonly ReminderCategory[]
> = {
  mine: ["custom", "occasion"],
  remembrance: ["remembrance"],
  todos: ["todo"],
};

/** On when every category the group covers is. */
export function isGroupOn(
  categories: readonly ReminderCategory[],
  group: NotificationGroup,
): boolean {
  return NOTIFICATION_GROUPS[group].every((c) => categories.includes(c));
}

/** The categories with a group's switched on or off, the rest untouched. */
export function withGroup(
  categories: readonly ReminderCategory[],
  group: NotificationGroup,
  on: boolean,
): ReminderCategory[] {
  const covered = NOTIFICATION_GROUPS[group];
  const rest = categories.filter((c) => !covered.includes(c));
  return on ? [...rest, ...covered] : rest;
}
