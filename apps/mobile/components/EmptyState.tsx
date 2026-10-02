import { StyleSheet, Text, View } from "react-native";
import { type Href, LinkButton } from "./LinkButton";
import { styles } from "../lib/styles";

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
        {actions.map((action, index) => (
          // The first, ordinary path is filled; the rest are quiet.
          <LinkButton
            key={action.label}
            {...action}
            tone={index === 0 ? "primary" : "secondary"}
            style={styles.emptyStateButton}
          />
        ))}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  actions: { gap: 12, minWidth: 240 },
});
