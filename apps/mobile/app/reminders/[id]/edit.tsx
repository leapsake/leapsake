import { useCallback } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { isReminderEditable } from "@leapsake/schema";
import { ReminderForm } from "../../../components/ReminderForm";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";
import { LoadState } from "../../../components/LoadState";

export default function ReminderEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => core.reminders.get(id), [core, id]);
  const { data: reminder, error } = useFocusedData(load);

  if (error !== null || reminder === null) return <LoadState error={error} />;
  if (reminder === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen
          options={{ title: "Edit reminder", headerBackTitle: "Back" }}
        />
        <Text style={styles.muted}>This reminder no longer exists.</Text>
      </View>
    );
  }
  // A deep link can reach an automatic reminder, whose save core would reject.
  if (!isReminderEditable(reminder)) {
    return (
      <View style={styles.screen}>
        <Stack.Screen
          options={{ title: "Edit reminder", headerBackTitle: "Back" }}
        />
        <Text style={styles.muted}>Automatic reminders can't be edited.</Text>
      </View>
    );
  }

  // The form declares the header itself; two `Stack.Screen`s would race.
  return (
    <ReminderForm
      title="Edit reminder"
      reminder={reminder}
      onSubmit={async (input) => {
        await core.reminders.update(id, input);
        router.back();
      }}
    />
  );
}
