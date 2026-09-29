import { Text, View } from "react-native";
import { Link } from "expo-router";
import type { Reminder } from "@leapsake/schema";
import { reminderLabel } from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

/** Every reminder whose text `@mention`s this person or pet, display-only:
 *  editing the reminder's text re-derives it. */
export function MentionedInSection({ reminders }: { reminders: Reminder[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Mentioned in</Text>
      {reminders.length === 0 ? (
        <Text style={styles.muted}>Not mentioned in any reminders.</Text>
      ) : (
        reminders.map((reminder) => (
          <Link
            key={reminder.id}
            href={{ pathname: "/reminders/[id]", params: { id: reminder.id } }}
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
