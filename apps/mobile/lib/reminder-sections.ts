import { type ReminderTiming, bucketReminders } from "@leapsake/view-models";

/**
 * Which section of Home a row is in. The five display buckets
 * (`bucketReminders`) plus `done`, which is the one section a row moves *into*
 * by being ticked rather than by the passing of time.
 */
export type ReminderSection =
  | "belated"
  | "today"
  | "available"
  | "coming"
  | "done";

/**
 * Top to bottom. Belated leads — everything overdue, the still-salvageable
 * first (a deadline that blew while the occasion is still ahead), then the
 * occasions that have gone. Coming and done sink below everything that is
 * actually asked of you today.
 */
const SECTION_ORDER: readonly ReminderSection[] = [
  "belated",
  "today",
  "available",
  "coming",
  "done",
];

/** The sections that fold away behind a tap. */
const COLLAPSIBLE: ReadonlySet<ReminderSection> = new Set(["coming", "done"]);

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

/** One reminder row. */
export interface ReminderRowItem<R> {
  kind: "row";
  id: string;
  reminder: R;
}

/**
 * The "you have cleared what was owed" line, emitted where the owed sections
 * would have been. `allClear` distinguishes the two kinds of done: nothing owed
 * with work still available, versus nothing left at all.
 */
export interface ReminderNoteItem {
  kind: "note";
  id: string;
  allClear: boolean;
}

export type ReminderListItem<R> =
  | ReminderHeaderItem
  | ReminderRowItem<R>
  | ReminderNoteItem;

/**
 * Home's `FlatList` data: section headings, reminder rows and the cleared-for-
 * the-day note interleaved in one flat array. Flat rather than a `SectionList`
 * because the note stands *where the owed sections would have been* — it belongs
 * to the sequence, not to a section — and because three item kinds in one array
 * is what lets the screen render each with a single `renderItem`.
 *
 * **Rows arrive in their natural order and stay in it.** They used to be held to
 * whatever order was on screen at the moment of a tap: Home's rows carried a
 * completion checkbox, and a tick both re-sorted the list and moved the row into
 * `done` — under the finger that had just tapped it. That is gone with the
 * checkbox. A row is a link and nothing else now, so nothing on this screen
 * writes, nothing re-sorts, and there is no moment for the list to hold still
 * for.
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
    ["available", buckets.available],
    ["coming", buckets.coming],
    ["done", buckets.done],
  ]);

  const items: ReminderListItem<R>[] = [];
  for (const section of SECTION_ORDER) {
    // The owed sections are belated and today; once both are behind us, say so
    // where they would have been.
    if (section === "available" && buckets.owed === 0 && reminders.length > 0)
      items.push({
        kind: "note",
        id: "note:owed",
        allClear: buckets.actionable === 0,
      });

    const rows = bySection.get(section) ?? [];
    if (rows.length === 0) continue;

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
      items.push({ kind: "row", id: reminder.id, reminder });
  }
  return items;
}
