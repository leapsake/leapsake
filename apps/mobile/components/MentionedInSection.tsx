import { Text, View } from "react-native";
import { Link } from "expo-router";
import type { Reminder } from "@leapsake/schema";
import { reminderLabel } from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

/**
 * The "Mentioned in" section shared by the Person and Pet detail screens — the
 * reverse of an inline `@mention`. Lists every reminder whose text mentions this
 * entity (including its own system birthday reminder), each linking to the
 * reminder. Display-only and always rendered with an empty placeholder, mirroring
 * desktop's MentionedInSection and the tag page's reminder list; a mention is
 * edited by changing the reminder text, which re-derives the backlink.
 *
 * `from` is who this list belongs to — the person's or pet's name — which labels
 * the back button on the reminder screen these rows push, since that screen shows
 * no title for a native stack to take one from.
 */
export function MentionedInSection({
  reminders,
  from,
}: {
  reminders: Reminder[];
  from: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Mentioned in</Text>
      {reminders.length === 0 ? (
        <Text style={styles.muted}>Not mentioned in any reminders.</Text>
      ) : (
        reminders.map((reminder) => (
          <Link
            key={reminder.id}
            href={{
              pathname: "/reminders/[id]",
              params: { id: reminder.id, from },
            }}
            style={styles.row}
          >
            <Text style={[styles.rowText, { color: colors.accent }]}>
              {reminderLabel(reminder)}
            </Text>
          </Link>
        ))
      )}
    </View>
  );
}
