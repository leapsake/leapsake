/**
 * What the **New** tab does when it is tapped, which depends on where you are.
 *
 * New is not a destination — it is a verb. On a screen that is unambiguously
 * about one kind of thing, tapping it should go straight into creating one of
 * those, and asking "person, reminder, or gift idea?" there would be a question
 * the screen has already answered. On a screen that is about everything, there
 * is a real question to ask, and the sheet asks it.
 *
 * Kept here rather than in `app/(tabs)/_layout.tsx` because a table of
 * "screen → what New means there" is exactly the kind of thing that rots
 * silently as screens are added, and this is the only shape of it that a test
 * can hold still: no React, no router, no navigation — a pathname and its
 * params in, an intention out.
 */

/** Where New leads: straight into a create screen, or into the chooser. */
export type NewAction = { kind: "route"; href: string } | { kind: "sheet" };

const SHEET: NewAction = { kind: "sheet" };

/**
 * The create screen for a searchable entity type, or `undefined` where the type
 * has no create screen at all.
 *
 * Holidays are a **seeded catalog** — you observe one, you don't author one —
 * and a tag exists only because something wears it, so neither has a route to
 * offer here. Person and pet share `/add`, which opens on Person with a toggle;
 * it takes no preselection today, so a pet-filtered search lands one tap from
 * where it was aiming rather than exactly on it.
 */
function createRouteForType(type: string): string | undefined {
  if (type === "person" || type === "pet") return "/add";
  if (type === "gift_idea") return "/gifts/new";
  return undefined;
}

/**
 * Resolve New against the screen it was tapped on.
 *
 * `pathname` is expo-router's, so the `(tabs)` group segment is already
 * stripped: Home is `/`, the search tab is `/search`.
 *
 * The two list screens below (`/people`, `/gifts`) cannot actually reach this
 * today — they push full-screen over the tab bar, so New isn't on screen to tap,
 * and each carries its own "+ Add" instead. They are in the table anyway: this
 * function should answer for a screen by what the screen *is*, not by which
 * navigator happens to host it this month.
 */
export function newActionFor(
  pathname: string,
  params: { type?: string } = {},
): NewAction {
  if (pathname === "/search") {
    if (params.type === undefined) return SHEET;
    const href = createRouteForType(params.type);
    return href === undefined ? SHEET : { kind: "route", href };
  }
  if (pathname === "/people") return { kind: "route", href: "/add" };
  if (pathname === "/gifts") return { kind: "route", href: "/gifts/new" };
  // Home and Settings are both about everything, so both ask.
  return SHEET;
}
