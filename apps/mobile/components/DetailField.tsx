import { Text, View } from "react-native";
import { styles } from "../lib/styles";

/**
 * One row of a detail screen's definition list: a muted label over its value.
 * Read-only — changing what it shows is the small screen behind the **Edit**
 * beside it ({@link EditLink}).
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
