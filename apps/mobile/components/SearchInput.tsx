import { type RefObject, useRef } from "react";
import { Pressable, Text, TextInput, type TextInputProps } from "react-native";
import { colors, styles } from "../lib/styles";

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
    <Pressable
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
    </Pressable>
  );
}
