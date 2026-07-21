import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { formatOccurrence } from "../../../lib/formatOccurrence";
import { colors, styles } from "../../../lib/styles";

// Holiday detail, ported from desktop's HolidayView: when it next falls, the
// dates after that, and who observes it.
//
// There is no edit affordance, and that is the design rather than an omission —
// a catalog holiday is read-only, and a user who wants a different Mother's Day
// hides this one and creates their own (holidays/research.md §2.6). That keeps a
// user's edit from ever losing to, or blocking, a catalog update.
export default function HolidayDetailScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(
    () => Promise.all([core.holidays.get(id), core.holidays.listObservers(id)]),
    [core, id],
  );
  const { data, error, reload } = useFocusedData(load);

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

  const [holiday, candidates]: [
    HolidayDetail | undefined,
    HolidayObserverCandidate[],
  ] = data;

  if (holiday === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Holiday" }} />
        <Text style={styles.muted}>This holiday no longer exists.</Text>
      </View>
    );
  }

  // `listObservers` answers for the whole address book (it is the picker's
  // read); this screen wants only those who actually observe.
  const observers = candidates.filter((c) => c.observes);

  // A const arrow rather than a `function` declaration: the latter is hoisted,
  // so TypeScript analyses it without the `holiday === undefined` guard above
  // and can't narrow the captured value.
  const toggleHidden = () => {
    const next = !holiday.hidden;
    const run = () =>
      core.holidays
        .setHidden(id, next)
        .then(reload, (e: unknown) => Alert.alert("Couldn't save", String(e)));
    if (!next) {
      void run();
      return;
    }
    Alert.alert(
      "Hide holiday",
      `Hide ${holiday.name}? It will stop producing reminders. Your saved answers about who observes it are kept.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Hide", style: "destructive", onPress: () => void run() },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: holiday.name }} />

      {holiday.hidden && (
        <Text style={styles.muted}>
          This holiday is hidden — it produces no reminders. Your saved answers
          about who observes it are kept.
        </Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming</Text>
        {holiday.upcoming.length === 0 ? (
          // An honest empty state: a precomputed holiday past its date table, or
          // a rule this build doesn't understand, reports nothing rather than
          // guessing a date.
          <Text style={styles.muted}>
            No upcoming dates are known for this holiday.
          </Text>
        ) : (
          holiday.upcoming.map((iso) => (
            <Text key={iso} style={styles.rowText}>
              {formatOccurrence(iso)}
              {holiday.durationDays !== null &&
                holiday.durationDays > 1 &&
                ` (${holiday.durationDays} days)`}
            </Text>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Observed by</Text>
        {observers.length === 0 ? (
          <Text style={styles.muted}>No one yet.</Text>
        ) : (
          // Each observer links to their own schedule, because the reminder rule
          // bears on the observance, not the holiday — which is what lets one
          // person get a gift reminder and another only a day-of call.
          observers.map((observer) => (
            <Link
              key={`${observer.bearerType}:${observer.bearerId}`}
              href={`/holidays/${id}/observers/${observer.bearerType}/${observer.bearerId}`}
              style={styles.row}
            >
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {observer.label}
                {observer.bearerType === "pet" ? " (pet)" : ""}
              </Text>
            </Link>
          ))
        )}
        <Link href={`/holidays/${id}/observers`} style={styles.link}>
          {observers.length === 0
            ? "Choose who celebrates this"
            : "Change who celebrates this"}
        </Link>
      </View>

      <Pressable accessibilityRole="button" onPress={toggleHidden}>
        <Text style={[styles.link, holiday.hidden ? undefined : styles.danger]}>
          {holiday.hidden ? "Unhide this holiday" : "Hide this holiday"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
