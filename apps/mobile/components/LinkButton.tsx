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

const BOX = {
  primary: styles.button,
  secondary: styles.buttonSecondary,
  destructive: [styles.button, styles.buttonDestructive],
};

/** A full-width button that navigates, its label led by an optional glyph
 *  that screen readers skip. */
export function LinkButton({
  href,
  label,
  glyph,
  tone = "primary",
  style,
  testID,
}: {
  href: Href;
  label: string;
  glyph?: string;
  tone?: keyof typeof BOX;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    // ⚠️ `flatten`: a `Link`'s child renders through `Slot`, which throws on
    // a `style` array rather than merging it.
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        style={StyleSheet.flatten([BOX[tone], styles.buttonBlock, style])}
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
            style={
              tone === "secondary"
                ? styles.buttonSecondaryText
                : styles.buttonText
            }
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
