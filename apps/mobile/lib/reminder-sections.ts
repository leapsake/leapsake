import {
  type ReminderSection,
  type ReminderTiming,
  bucketReminders,
} from "@leapsake/view-models";

export type { ReminderSection };

/** Top to bottom: what is owed now leads, and what can wait sinks. */
const SECTION_ORDER: readonly ReminderSection[] = [
  "belated",
  "today",
  "next7",
  "later",
  "done",
];

/** The sections that fold away behind a tap. */
const COLLAPSIBLE: ReadonlySet<ReminderSection> = new Set([
  "next7",
  "later",
  "done",
]);

/** A section heading, with the count the screen renders beside it. */
export interface ReminderHeaderItem {
  kind: "header";
  id: string;
  section: ReminderSection;
  count: number;
  /** Whether tapping it folds the section away. */
  collapsible: boolean;
  collapsed: boolean;
}

/** One reminder row, with the section that decides its countdown. */
export interface ReminderRowItem<R> {
  kind: "row";
  id: string;
  section: ReminderSection;
  reminder: R;
}

/** The done-for-the-day line, where Belated and Today would have been. */
export interface ReminderNoteItem {
  kind: "note";
  id: string;
}

export type ReminderListItem<R> =
  | ReminderHeaderItem
  | ReminderRowItem<R>
  | ReminderNoteItem;

/**
 * Home's headings, rows and done-for-the-day note, flat. Later's heading shows
 * only once Next 7 days is open, or when the next week is empty.
 */
export function reminderListItems<R extends ReminderTiming & { id: string }>(
  reminders: readonly R[],
  options: {
    /** The sections the user has folded away. */
    collapsed: ReadonlySet<ReminderSection>;
    now?: number;
  },
): ReminderListItem<R>[] {
  const buckets = bucketReminders(reminders, options.now);
  const bySection = new Map<ReminderSection, readonly R[]>([
    ["belated", buckets.belated],
    ["today", buckets.today],
    ["next7", buckets.next7],
    ["later", buckets.later],
    ["done", buckets.done],
  ]);

  const items: ReminderListItem<R>[] = [];
  for (const section of SECTION_ORDER) {
    if (section === "next7" && buckets.owed === 0 && reminders.length > 0)
      items.push({ kind: "note", id: "note:owed" });

    const rows = bySection.get(section) ?? [];
    if (rows.length === 0) continue;
    if (
      section === "later" &&
      buckets.next7.length > 0 &&
      options.collapsed.has("next7")
    )
      continue;

    const collapsed = options.collapsed.has(section);
    items.push({
      kind: "header",
      id: `header:${section}`,
      section,
      count: rows.length,
      collapsible: COLLAPSIBLE.has(section),
      collapsed,
    });
    if (collapsed) continue;
    for (const reminder of rows)
      items.push({ kind: "row", id: reminder.id, section, reminder });
  }
  return items;
}
