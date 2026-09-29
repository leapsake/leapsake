import { Text, View } from "react-native";
import { styles } from "../lib/styles";

/** A read-only detail row: a muted label over its value. */
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
