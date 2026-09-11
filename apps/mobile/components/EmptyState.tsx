import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/** Where one of an empty state's offers leads — `Link`'s own href type. */
type Href = ComponentProps<typeof Link>["href"];

/**
 * What a list screen shows when it has nothing to list: the fact, and then the
 * way out of it.
 *
 * The fact alone ("Nobody here yet.") is a dead end. The way to fill the list is
 * the **➕** in the corner ({@link NewLink}), which is on screen — but it is a
 * glyph at the far edge, and a glyph does not say what *this* list wants. So an
 * empty list restates its own add action where the user is already reading, in
 * the words of the thing they'd be adding: "+ Add a person or pet".
 *
 * The corner button and this are the same action said twice, deliberately and
 * only here: an empty list is exactly when a user has no idea what the app
 * expects of them, and it is also the only state in which the duplication costs
 * nothing, because there is no content for the second copy to push out of the
 * way.
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
      <Text style={[styles.muted, styles.emptyStateMessage]}>{message}</Text>
      {actions.map((action, index) => {
        // The ordinary path wears the filled button, the rest the quiet one —
        // the same two weights a reminder's offers use, and for the same reason:
        // a screen offering two ways in should say which one it means. `actions`
        // is documented as being in offer order, so the first *is* that path.
        const isPrimary = index === 0;
        return (
          // ⚠️ `flatten`: a `Link`'s child renders through `Slot`, which throws
          // on a `style` array rather than merging it.
          <Link key={action.label} href={action.href} asChild>
            <Pressable
              accessibilityRole="button"
              style={StyleSheet.flatten([
                isPrimary ? styles.button : styles.buttonSecondary,
                styles.buttonBlock,
                styles.emptyStateButton,
              ])}
            >
              <Text
                style={
                  isPrimary ? styles.buttonText : styles.buttonSecondaryText
                }
              >
                {action.label}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}
