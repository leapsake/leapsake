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

import { categoryFor } from "./search-categories";

/** Where New leads: straight into a create screen, or into the chooser. */
export type NewAction = { kind: "route"; href: string } | { kind: "sheet" };

const SHEET: NewAction = { kind: "sheet" };

/**
 * Resolve New against the screen it was tapped on.
 *
 * `pathname` is expo-router's, so the `(tabs)` group segment is already
 * stripped: Home is `/`, the search tab is `/search`.
 *
 * A filtered search answers the question from
 * {@link SEARCH_CATEGORIES | the browse table} rather than from a second copy of
 * it here — including the categories that create *nothing* (a holiday is seeded,
 * a tag exists only because something wears it), which fall back to asking.
 *
 * The two list screens below were unreachable from here for a while: both pushed
 * full-screen over the tab bar, so New wasn't on screen to tap. They were in the
 * table anyway, on the principle that this function should answer for a screen by
 * what the screen *is* and not by which navigator happens to host it — and the
 * catalogs are now inside the tab navigator (`app/(tabs)/_layout.tsx`), so both
 * rows are live — and are now the *only* way in, since both catalogs gave up the
 * "+ Add" they used to carry in the corner once New reached the same screen.
 */
export function newActionFor(
  pathname: string,
  params: { type?: string } = {},
): NewAction {
  if (pathname === "/search") {
    const href = categoryFor(params.type)?.createHref;
    return href === undefined ? SHEET : { kind: "route", href };
  }
  if (pathname === "/people") return { kind: "route", href: "/add" };
  if (pathname === "/gifts") return { kind: "route", href: "/gifts/new" };
  // Everything else asks, for one of two reasons. Home and Settings are about
  // *everything*, so the question is real. Holidays and Tags are about one kind
  // of thing each but you cannot author either of them — a holiday is seeded, a
  // tag exists only because something wears it — so there is no create screen to
  // send New to, and the chooser is the honest answer rather than a dead tap.
  return SHEET;
}
