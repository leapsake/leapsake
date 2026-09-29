import { Text, View } from "react-native";
import { type Tag, tagLabel } from "@leapsake/schema";
import { ChipTextField } from "./ChipTextField";
import { styles } from "../lib/styles";

/**
 * Stored tags as this field's value. Every writer of a person or pet needs
 * it: `update` replaces the tag set, so passing `[]` would strip them.
 */
export const tagsRawOf = (tags: readonly Tag[]): string =>
  tags.map((tag) => tagLabel(tag.name)).join(" ");

/** The editable Tags field, apart from the name fields so a form can put it
 *  last; {@link TagsField} is the read-only one. */
export function TagsInput({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Space-separated tag labels, exactly as typed. */
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ChipTextField
        grammar="tags"
        style={styles.input}
        value={value}
        onChangeText={onChange}
      />
      <Text style={styles.muted}>Space-separated — each word is a tag.</Text>
    </View>
  );
}
