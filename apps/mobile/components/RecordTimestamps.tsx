import { Text, View } from "react-native";
import { formatTimestampCompact } from "@leapsake/ui/headless";
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
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaText}>
        Created {formatTimestampCompact(createdAt)}
      </Text>
      <Text style={styles.metaText}>
        Updated {formatTimestampCompact(updatedAt)}
      </Text>
    </View>
  );
}
