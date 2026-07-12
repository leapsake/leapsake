import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { reminderLabel } from "@leapsake/schema";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

/** Reminder detail: title/body, completion status, and the edit/complete/delete
 *  actions. The body shows its inline `#tags` verbatim — they *are* the tags. */
export default function ReminderDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.reminders.get(id), [core, id]);
  const { data: reminder, error, reload } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }
  if (reminder === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }
  if (reminder === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Reminder" }} />
        <Text style={styles.muted}>This reminder no longer exists.</Text>
      </View>
    );
  }

  const done = reminder.completedAt !== null;
  const label = reminderLabel(reminder);

  function toggle() {
    core.reminders.setCompleted(id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn't update", String(e)),
    );
  }

  function confirmDelete() {
    Alert.alert("Delete reminder", `Delete “${label}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          core.reminders.softDelete(id).then(
            () => router.back(),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          ),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: reminderLabel(reminder) }} />

      {reminder.title !== null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Title</Text>
          <Text style={styles.fieldValue}>{reminder.title}</Text>
        </View>
      )}
      {reminder.body !== null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Details</Text>
          <Text style={styles.fieldValue}>{reminder.body}</Text>
        </View>
      )}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Status</Text>
        <Text style={styles.fieldValue}>{done ? "Completed" : "Open"}</Text>
      </View>

      <View style={styles.rowActions}>
        <Pressable accessibilityRole="button" onPress={toggle}>
          <Text style={styles.link}>{done ? "Reopen" : "Mark done"}</Text>
        </Pressable>
        <Link href={`/reminders/${id}/edit`} style={styles.link}>
          Edit
        </Link>
        <Pressable accessibilityRole="button" onPress={confirmDelete}>
          <Text style={[styles.link, styles.danger]}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
