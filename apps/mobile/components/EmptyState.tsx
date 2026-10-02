import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/** Where one of an empty state's offers leads — `Link`'s own href type. */
type Href = ComponentProps<typeof Link>["href"];

/**
 * An empty list's message and the way to fill it, restating the corner ➕ in
 * words. Only for lists the user can add to.
 */
export function EmptyState({
  message,
  actions,
}: {
  message: string;
  /** In the order they're offered; the first is the ordinary path. */
  actions: readonly { href: Href; label: string; glyph?: string }[];
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={[styles.muted, styles.emptyStateMessage]}>{message}</Text>
      {/* Centred by its parent, so as wide as its widest button; each
          button stretches to that width. */}
      <View style={local.actions}>
        {actions.map((action, index) => {
          // The first, ordinary path is filled; the rest are quiet.
          const isPrimary = index === 0;
          return (
            // ⚠️ `flatten`: a `Link`'s child renders through `Slot`, which
            // throws on a `style` array rather than merging it.
            <Link key={action.label} href={action.href} asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={StyleSheet.flatten([
                  isPrimary ? styles.button : styles.buttonSecondary,
                  styles.buttonBlock,
                  styles.emptyStateButton,
                ])}
              >
                <View style={local.content}>
                  {action.glyph !== undefined && (
                    // Decoration: the label alone names the button.
                    <Text
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      style={local.glyph}
                    >
                      {action.glyph}
                    </Text>
                  )}
                  <Text
                    style={
                      isPrimary ? styles.buttonText : styles.buttonSecondaryText
                    }
                  >
                    {action.label}
                  </Text>
                </View>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  actions: { gap: 12, minWidth: 240 },
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  glyph: { fontSize: 18 },
});
