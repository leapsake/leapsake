import { Text, View } from "react-native";
import { type Tag, tagLabel } from "@leapsake/schema";
import { ChipTextField } from "./ChipTextField";
import { styles } from "../lib/styles";

/**
 * A record's stored tags as this field's value: labels, space-separated, which
 * `parseTagNames` reads back.
 *
 * It lives here because it is the inverse of what the field produces, and
 * because every screen that writes a person or a pet needs it — including the
 * ones that never show a tag. `people.update` and `pets.update` *replace* the
 * whole tag set from their third argument, so a name-and-gender screen that
 * passed `[]` would quietly strip them; instead it carries the raw string
 * through the draft untouched and hands it back.
 */
export const tagsRawOf = (tags: readonly Tag[]): string =>
  tags.map((tag) => tagLabel(tag.name)).join(" ");

/**
 * The editable Tags field: the whole of the screen behind a record's **Edit
 * tags**, and the closing question on the create form — the counterpart to
 * {@link TagsField}, which renders the same tags read-only (and linked) on the
 * detail screens.
 *
 * It lives outside {@link PersonFields} and {@link PetFields} because the create
 * form puts it *last*, below the staged milestones, contacts and holidays,
 * rather than tucked in with the name and gender. Tagging is the one thing on
 * that form you can only really do once you've written down who this is, so it
 * reads as a closing step rather than another identity field.
 */
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
