import { type RefObject, useRef } from "react";
import { Pressable, Text, TextInput, type TextInputProps } from "react-native";
import { colors, styles } from "../lib/styles";

/**
 * A text field that says it searches: 🔍 at the head of the box, and the text
 * beside it. Used by the Search tab and by the filter inside a
 * {@link SuggestField}'s sheet.
 *
 * It owns the *box* and nothing else — the value, what is searched and what the
 * results are stay with the caller, which is why this takes `TextInputProps` and
 * forwards them rather than growing an interface of its own. The two callers do
 * genuinely different things inside the same frame (one queries the database
 * with latest-wins tokens and renders hits, the other filters three strings in
 * memory), and a component that tried to own both would be one component
 * pretending to be two.
 *
 * What it does own is the part that is easy to get subtly wrong twice:
 *
 * - **The glyph is a sibling of the input, not part of its text.** It has to
 *   outlive the placeholder, and a value read back to a user — or sent to a
 *   query — must never begin with an emoji.
 * - **It is hidden from both screen readers** (iOS reads the first prop, Android
 *   the second) and the row around it is `accessible={false}`, so the field
 *   stays the single accessible element and the glyph adds no stop of its own.
 * - **Tapping anywhere in the box focuses the field**, which the glyph's own
 *   share of the box would otherwise be a dead patch of.
 * - **The box and the input are both composed from `styles.input`** — the row
 *   wears it for the outline and the height, the input takes it back minus the
 *   box for the type — so this field cannot drift from the app's plain ones.
 *
 * `accessibilityRole="search"` is the default for the same reason the glyph is
 * here at all; a caller whose field is something else can say so.
 */
export function SearchInput({
  inputRef,
  ...rest
}: TextInputProps & {
  /**
   * The caller's handle on the field, for focusing it from somewhere else — the
   * Search tab raises the keyboard when its tab is pressed a second time. Left
   * out, the field still focuses on tap: that uses this ref or its own.
   */
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
        // iOS only, and worth having in both fields: the value a search box
        // holds is more often replaced than edited.
        clearButtonMode="while-editing"
        {...rest}
      />
    </Pressable>
  );
}
