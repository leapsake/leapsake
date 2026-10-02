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
import { BUTTON_BOX, BUTTON_LABEL, type ButtonTone } from "./Button";

/** Where a {@link LinkButton} leads — `Link`'s own href type. */
export type Href = ComponentProps<typeof Link>["href"];

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
  tone?: ButtonTone;
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
        style={StyleSheet.flatten([BUTTON_BOX[tone], style])}
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
          <Text style={BUTTON_LABEL[tone]}>{label}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

const local = StyleSheet.create({
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  glyph: { fontSize: 18 },
});
