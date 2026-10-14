import { Text, View } from "react-native";
import { formatDateTime } from "@leapsake/schema";
import { useDateFormat } from "../lib/date-format";
import { styles } from "../lib/styles";

/** When a record was made and last changed: one small muted line, not
 *  fields, since bookkeeping is not what the page is about. */
export function RecordTimestamps({
  createdAt,
  updatedAt,
}: {
  createdAt: number;
  updatedAt: number;
}) {
  const dateFormat = useDateFormat();
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaText}>
        Created {formatDateTime(createdAt, dateFormat)}
      </Text>
      <Text style={styles.metaText}>
        Updated {formatDateTime(updatedAt, dateFormat)}
      </Text>
    </View>
  );
}
