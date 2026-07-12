import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ReminderForm } from "../../../components/ReminderForm";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";

export default function ReminderEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.reminders.get(id), [core, id]);
  const { data: reminder, error } = useFocusedData(load);

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
        <Stack.Screen options={{ title: "Edit reminder" }} />
        <Text style={styles.muted}>This reminder no longer exists.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Edit reminder" }} />
      <ReminderForm
        reminder={reminder}
        submitLabel="Save"
        onCancel={() => router.back()}
        onSubmit={async (input) => {
          await core.reminders.update(id, input);
          router.back();
        }}
      />
    </>
  );
}
