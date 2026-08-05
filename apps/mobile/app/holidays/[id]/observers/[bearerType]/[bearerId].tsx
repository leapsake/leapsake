import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import { HeaderSave } from "../../../../../components/HeaderSave";
import { ReminderScheduleFields } from "../../../../../components/ReminderScheduleFields";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

// One person's reminder schedule for one holiday, ported from desktop's
// HolidayObservanceSchedule — "what should Leapsake remind me about for Alice at
// Christmas?"
//
// This is the screen that makes the feature do anything. Observances ship with
// every action **off** (holidays all land on the same day, so a default-on wish
// would flood late November), so saying someone celebrates a holiday records the
// fact but generates nothing until a rule is switched on here.
//
// It is per-*observance* rather than per-holiday because the rule's bearer is
// the observance (`@leapsake/holidays` README, the three layers): that is exactly what lets "gift
// Alice 30 days before Christmas" and "just call Grandma day-of" coexist under
// one holiday.
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

  // `null` until the stored schedule arrives, so a re-focus can't discard edits.
  const [rules, setRules] = useState<ReminderRuleInput[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }

  if (data === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

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
          // Saving lives in the header, as it does on every other form screen;
          // there's nothing to validate here, so it's only disabled mid-write.
          headerRight: () => (
            <HeaderSave canSave saving={saving} onPress={save} />
          ),
        }}
      />

      {holiday.hidden && (
        <Text style={styles.muted}>
          This holiday is hidden, so these reminders won't be generated until it
          is unhidden.
        </Text>
      )}

      <ReminderScheduleFields value={schedule} onChange={setRules} />
    </ScrollView>
  );
}
