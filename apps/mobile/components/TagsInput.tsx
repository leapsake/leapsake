import { Text, View } from "react-native";
import { ChipTextField } from "./ChipTextField";
import { styles } from "../lib/styles";

/**
 * The editable Tags field shared by the person and pet forms — the counterpart to
 * {@link TagsField}, which renders the same tags read-only (and linked) on the
 * detail screens.
 *
 * It lives outside {@link PersonFields} and {@link PetFields} because the add
 * screen puts it *last*, below the staged milestones, contacts and holidays,
 * rather than tucked in with the name and gender. Tagging is the one thing on
 * that form you can only really do once you've written down who this is, so it
 * reads as a closing step rather than another identity field. On a detail screen
 * it is its own editable field, opened from the Tags row.
 */
export function TagsInput({
  label,
  value,
  onChange,
}: {
  /** Omitted where the field is already named by what encloses it — the detail
   *  screen's Tags row carries the name in its own header. */
  label?: string;
  /** Space-separated tag labels, exactly as typed. */
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      {label !== undefined && <Text style={styles.fieldLabel}>{label}</Text>}
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
