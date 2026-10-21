import { type RefObject, useRef } from "react";
import { Text, TextInput, type TextInputProps } from "react-native";
import { colors, styles } from "../lib/styles";
import { Tappable } from "./Tappable";

/**
 * A field with 🔍 at its head: the box only, the value the caller's. The glyph
 * is a sibling, hidden from screen readers, so no value starts with an emoji.
 */
export function SearchInput({
  inputRef,
  ...rest
}: TextInputProps & {
  /** For focusing the field from elsewhere; it focuses on tap without one. */
  inputRef?: RefObject<TextInput | null>;
}) {
  const own = useRef<TextInput>(null);
  const ref = inputRef ?? own;

  return (
    <Tappable
      accessible={false}
      style={[styles.input, styles.searchRow]}
      onPress={() => ref.current?.focus()}
    >
      <Text
        style={styles.searchGlyph}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        🔍
      </Text>
      <TextInput
        ref={ref}
        style={[styles.input, styles.searchRowInput]}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        accessibilityRole="search"
        // iOS only: a search is more often replaced than edited.
        clearButtonMode="while-editing"
        {...rest}
      />
    </Tappable>
  );
}
