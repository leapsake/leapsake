import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/** Where one of an empty state's offers leads — `Link`'s own href type. */
type Href = ComponentProps<typeof Link>["href"];

/**
 * What a list screen shows when it has nothing to list: the fact, and then the
 * way out of it.
 *
 * The fact alone ("Nobody here yet.") is a dead end on a phone, where the only
 * affordance for filling the list is a small "+ Add" in the header — the corner
 * of the screen a first-time user is least likely to be looking at, and the one
 * place the empty message is *not*. So an empty list restates its own add action
 * where the user is already reading, in words rather than a glyph.
 *
 * Only for lists the user can actually add to. Holidays and Tags are catalogs
 * that fill themselves (a seeded list; a tag exists only because something wears
 * it), and their empty states say so instead of offering an action that doesn't
 * exist.
 */
export function EmptyState({
  message,
  actions,
}: {
  message: string;
  /** In the order they're offered; the first is the ordinary path. */
  actions: readonly { href: Href; label: string }[];
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.muted}>{message}</Text>
      {actions.map((action) => (
        <Link key={action.label} href={action.href} style={styles.link}>
          {action.label}
        </Link>
      ))}
    </View>
  );
}
