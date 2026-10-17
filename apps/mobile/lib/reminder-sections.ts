import {
  type ReminderSection,
  type ReminderTiming,
  bucketReminders,
  foldWishes,
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

/** A holiday occurrence's wishes as one line, before the day; open, its rows
 *  follow it. */
export interface ReminderWishGroupItem<R> {
  kind: "wish-group";
  id: string;
  /** The occurrence it folds, which {@link reminderListItems} opens by. */
  key: string;
  section: ReminderSection;
  greeting: string;
  icon?: string;
  reminders: R[];
  expanded: boolean;
}

/** The done-for-the-day line, where Belated and Today would have been. */
export interface ReminderNoteItem {
  kind: "note";
  id: string;
}

export type ReminderListItem<R> =
  | ReminderHeaderItem
  | ReminderRowItem<R>
  | ReminderWishGroupItem<R>
  | ReminderNoteItem;

/**
 * Home's headings, rows and done-for-the-day note, flat. Later's heading shows
 * only once Next 7 days is open, or when the next week is empty.
 */
export function reminderListItems<
  R extends ReminderTiming & {
    id: string;
    wishGroup?: { key: string; greeting: string; icon?: string } | null;
  },
>(
  reminders: readonly R[],
  options: {
    /** The sections the user has folded away. */
    collapsed: ReadonlySet<ReminderSection>;
    /** The wish lines the user has opened, by key. */
    expandedWishes?: ReadonlySet<string>;
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
    // Before the day, each occasion's wishes are one line.
    const upcoming = section === "next7" || section === "later";
    const lines = upcoming
      ? foldWishes(rows)
      : rows.map((reminder) => ({ kind: "row" as const, reminder }));
    for (const line of lines) {
      if (line.kind === "row") {
        items.push({
          kind: "row",
          id: line.reminder.id,
          section,
          reminder: line.reminder,
        });
        continue;
      }
      const expanded = options.expandedWishes?.has(line.key) ?? false;
      items.push({
        kind: "wish-group",
        id: `wishes:${line.key}`,
        key: line.key,
        section,
        greeting: line.greeting,
        icon: line.icon,
        reminders: line.reminders,
        expanded,
      });
      if (expanded)
        for (const reminder of line.reminders)
          items.push({ kind: "row", id: reminder.id, section, reminder });
    }
  }
  return items;
}
