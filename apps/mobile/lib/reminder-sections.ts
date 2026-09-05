import { type ReminderTiming, bucketReminders } from "@leapsake/view-models";
import { type Identified, stickyOrder } from "./sticky-order";

/**
 * Which section of Home a row is in. The five display buckets
 * (`bucketReminders`) plus `done`, which is the one section a row moves *into*
 * by being ticked rather than by the passing of time.
 */
export type ReminderSection =
  | "past-due"
  | "belated"
  | "today"
  | "available"
  | "coming"
  | "done";

/**
 * Top to bottom. Past due leads because its deadline blew while the occasion is
 * still ahead — the most salvageable thing on the screen; belated follows,
 * prominent but unrecoverable. Coming and done sink below everything that is
 * actually asked of you today.
 */
const SECTION_ORDER: readonly ReminderSection[] = [
  "past-due",
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

/** What the screen remembers between a tap and the reload it triggers. */
export interface ReminderListPins {
  /** The displayed row order at the moment of the tap (see {@link stickyOrder}). */
  order: readonly string[];
  /**
   * The section each row was in at that moment.
   *
   * ⚠️ Pinning the order alone is not enough once the list has headings. Ticking
   * a row moves it to `done`, which is exactly the jump `stickyOrder` exists to
   * absorb — but with the row held in place and its *section* free to change,
   * the headings re-flow around a row that did not move, which reads worse than
   * the jump did. Both are pinned, and both are released together on blur.
   */
  sections: ReadonlyMap<string, ReminderSection>;
}

/** The un-pinned state: the natural order, untouched. */
export const NO_PINS: ReminderListPins = {
  order: [],
  sections: new Map(),
};

/**
 * Home's `FlatList` data: section headings and reminder rows interleaved in one
 * flat array.
 *
 * One flat list rather than a `SectionList` because {@link stickyOrder} works on
 * a flat `Identified[]`, and holding a ticked row under the user's finger is
 * load-bearing on a phone — see its doc-comment. Headers are injected after the
 * ordering, so they never disturb it.
 *
 * Collapsing hides a section's rows and keeps its heading, so the count stays
 * visible and the section is still reachable.
 */
export function reminderListItems<R extends ReminderTiming & Identified>(
  reminders: readonly R[],
  options: {
    pins: ReminderListPins;
    /** The sections the user has folded away. */
    collapsed: ReadonlySet<ReminderSection>;
    now?: number;
  },
): ReminderListItem<R>[] {
  const buckets = bucketReminders(reminders, options.now);
  const natural: [ReminderSection, R[]][] = [
    ["past-due", buckets.pastDue],
    ["belated", buckets.belated],
    ["today", buckets.today],
    ["available", buckets.available],
    ["coming", buckets.coming],
    ["done", buckets.done],
  ];

  // Re-file each row under the section it was pinned in, if it was pinned. The
  // buckets arrive in display order, so appending preserves it.
  const bySection = new Map<ReminderSection, R[]>(
    SECTION_ORDER.map((section) => [section, []]),
  );
  for (const [section, rows] of natural)
    for (const row of rows)
      bySection.get(options.pins.sections.get(row.id) ?? section)?.push(row);

  const items: ReminderListItem<R>[] = [];
  for (const section of SECTION_ORDER) {
    // The owed sections are past due, belated and today; once all three are
    // behind us, say so where they would have been.
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
    for (const reminder of stickyOrder(rows, options.pins.order))
      items.push({ kind: "row", id: reminder.id, reminder });
  }
  return items;
}

/** The pins to hold the list to, snapshotted from what is on screen right now. */
export function pinsFrom<R>(
  items: readonly ReminderListItem<R>[],
): ReminderListPins {
  const order: string[] = [];
  const sections = new Map<string, ReminderSection>();
  let section: ReminderSection | null = null;
  for (const item of items) {
    if (item.kind === "header") section = item.section;
    else if (item.kind === "row" && section !== null) {
      order.push(item.id);
      sections.set(item.id, section);
    }
  }
  return { order, sections };
}
