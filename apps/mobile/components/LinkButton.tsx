import type { ComponentProps } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/** Where a {@link LinkButton} leads — `Link`'s own href type. */
export type Href = ComponentProps<typeof Link>["href"];

/** A full-width button that navigates, filled or quiet, its label led by an
 *  optional glyph that screen readers skip. */
export function LinkButton({
  href,
  label,
  glyph,
  primary = true,
  style,
}: {
  href: Href;
  label: string;
  glyph?: string;
  primary?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    // ⚠️ `flatten`: a `Link`'s child renders through `Slot`, which throws on
    // a `style` array rather than merging it.
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={StyleSheet.flatten([
          primary ? styles.button : styles.buttonSecondary,
          styles.buttonBlock,
          style,
        ])}
      >
        <View style={local.content}>
          {glyph !== undefined && (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={local.glyph}
            >
              {glyph}
            </Text>
          )}
          <Text
            style={primary ? styles.buttonText : styles.buttonSecondaryText}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const local = StyleSheet.create({
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  glyph: { fontSize: 18 },
});
