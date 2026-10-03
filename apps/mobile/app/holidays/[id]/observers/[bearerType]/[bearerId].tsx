import { useCallback, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import { HeaderSave } from "../../../../../components/HeaderSave";
import { ReminderScheduleFields } from "../../../../../components/ReminderScheduleFields";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";
import { LoadState } from "../../../../../components/LoadState";

// One observer's reminder schedule for one holiday. Every action starts off,
// so nothing is reminded until a rule is switched on here.
export default function ObservanceScheduleScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, bearerType, bearerId } = useLocalSearchParams<{
    id: string;
    bearerType: "person" | "pet";
    bearerId: string;
  }>();

  const load = useCallback(
    () =>
      Promise.all([
        core.holidays.get(id),
        core.holidays.listObservers(id),
        core.holidays.getObservanceSchedule(id, bearerType, bearerId),
      ]),
    [core, id, bearerType, bearerId],
  );
  const { data, error } = useFocusedData(load);

  // `null` until the stored schedule arrives, so a re-focus keeps edits.
  const [rules, setRules] = useState<ReminderRuleInput[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (error !== null || data === null) return <LoadState error={error} />;

  const [holiday, candidates, stored]: [
    HolidayDetail | undefined,
    HolidayObserverCandidate[],
    ReminderRuleInput[],
  ] = data;

  const observer = candidates.find(
    (c) => c.bearerType === bearerType && c.bearerId === bearerId,
  );

  if (holiday === undefined || observer === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Reminders" }} />
        <Text style={styles.muted}>This observance no longer exists.</Text>
      </View>
    );
  }

  const schedule = rules ?? stored;

  function save() {
    setSaving(true);
    core.holidays
      .setObservanceSchedule(id, bearerType, bearerId, schedule)
      .then(
        () => router.back(),
        (e: unknown) => {
          setSaving(false);
          Alert.alert("Couldn't save", String(e));
        },
      );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen
        options={{
          title: `${observer.label} — ${holiday.name}`,
          // Nothing here to validate, so Save only waits out a write in flight.
          headerRight: () => <HeaderSave saving={saving} onPress={save} />,
        }}
      />

      {holiday.hidden && (
        <Text style={styles.muted}>
          This holiday is hidden, so these reminders won't be generated until it
          is unhidden.
        </Text>
      )}

      <ReminderScheduleFields
        value={schedule}
        greeting={holiday.greeting}
        onChange={setRules}
      />
    </ScrollView>
  );
}
