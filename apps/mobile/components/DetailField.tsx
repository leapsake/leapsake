import { Text, View } from "react-native";
import { styles } from "../lib/styles";

/**
 * One row of a detail screen's definition list: a muted label over its value.
 * Read-only — an editable one is an {@link EditableField}, which names itself in
 * its own header rather than here.
 */
export function DetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}
