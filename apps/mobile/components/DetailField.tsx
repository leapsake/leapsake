import { Text, View } from "react-native";
import { styles } from "../lib/styles";

/**
 * One row of a detail screen's definition list: a muted label over its value.
 * Read-only, which every row on those screens now is — changing any of it is the
 * record's form ({@link EntityEditForm}), reached from the header's one Edit.
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
