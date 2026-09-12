import {
  type ReminderSection,
  type ReminderTiming,
  bucketReminders,
} from "@leapsake/view-models";

export type { ReminderSection };

/**
 * Top to bottom. Belated leads — everything overdue, the still-salvageable
 * first (a deadline that blew while the occasion is still ahead), then the
 * occasions that have gone — and Today, everything that can be done now,
 * follows. Next 7 days, Later and Completed sink below everything that is
 * actually asked of you today.
 */
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

/** One reminder row, with the section it is in — which is what decides the
 *  countdown it shows. */
export interface ReminderRowItem<R> {
  kind: "row";
  id: string;
  section: ReminderSection;
  reminder: R;
}

/**
 * The "you're done for the day" line, emitted where Belated and Today would have
 * been once nothing is left in either — the finish line folding Available into
 * Today was for.
 */
export interface ReminderNoteItem {
  kind: "note";
  id: string;
}

export type ReminderListItem<R> =
  | ReminderHeaderItem
  | ReminderRowItem<R>
  | ReminderNoteItem;

/**
 * Home's `FlatList` data: section headings, reminder rows and the done-for-the-
 * day note interleaved in one flat array. Flat rather than a `SectionList`
 * because the note stands *where the owed sections would have been* — it belongs
 * to the sequence, not to a section — and because three item kinds in one array
 * is what lets the screen render each with a single `renderItem`.
 *
 * **Rows arrive in their natural order and stay in it.** Nothing on this screen
 * writes — a row is a link and nothing else — so nothing re-sorts under a
 * finger, and there is no moment for the list to hold still for.
 *
 * **Later opens from inside Next 7 days** *(owner, 2026-09-11)*. What is coming
 * is one closed section that opens twice: its heading shows the next week, and
 * only once that is open does Later's heading appear beneath it — most people
 * want the next few days, and rarely the month. With nothing in the next week,
 * Later stands on its own rather than behind an empty heading.
 *
 * Collapsing hides a section's rows and keeps its heading, so the count stays
 * visible and the section is still reachable.
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
  // The buckets arrive in display order and are read back in `SECTION_ORDER`,
  // which is the same order — named once here so the two cannot drift.
  const bySection = new Map<ReminderSection, readonly R[]>([
    ["belated", buckets.belated],
    ["today", buckets.today],
    ["next7", buckets.next7],
    ["later", buckets.later],
    ["done", buckets.done],
  ]);

  const items: ReminderListItem<R>[] = [];
  for (const section of SECTION_ORDER) {
    // The owed sections are belated and today; once both are behind us, say so
    // where they would have been.
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
