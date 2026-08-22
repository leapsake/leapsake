import { Text, View } from "react-native";
import { formatTimestampCompact } from "@leapsake/ui/headless";
import { styles } from "../lib/styles";

/**
 * When a record was made and when it last changed, as a caption at the foot of
 * its detail screen.
 *
 * Not a {@link DetailField} pair, deliberately: given a label over a value at
 * field size, bookkeeping reads as two more things the page is about, and it
 * sits at the end precisely because it isn't. One small muted line says the same
 * thing without asking to be read.
 *
 * The row wraps rather than clipping — on the narrowest phones the two halves
 * fall onto separate lines, which is still smaller than the fields they used to
 * be.
 */
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
