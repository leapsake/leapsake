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
import { Typeahead } from "../../../components/Typeahead";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { holidayTitle } from "../../../lib/record-title";
import { colors, styles } from "../../../lib/styles";
import { formatOccurrence } from "@leapsake/schema";

// Holiday detail, ported from desktop's HolidayView: when it next falls, the
// dates after that, and who observes it.
//
// There is no edit affordance, and that is the design rather than an omission —
// a catalog holiday is read-only, and a user who wants a different Mother's Day
// hides this one and creates their own (`@leapsake/holidays` README, read-only catalog rows). That keeps a
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

  // One read serves both halves: who observes it, and who could be added.
  // Excluding current observers from the suggestions is what stops the same
  // person being added twice and shrinks the list as you go.
  const observers = candidates.filter((c) => c.observes);
  const addable = candidates.filter((c) => !c.observes);

  const setObserves = (
    observer: HolidayObserverCandidate,
    observes: boolean,
  ) => {
    core.holidays
      .setObservers(id, [
        {
          bearerType: observer.bearerType,
          bearerId: observer.bearerId,
          observes,
        },
      ])
      .then(reload, (e: unknown) => Alert.alert("Couldn't save", String(e)));
  };

  const removeObserver = (observer: HolidayObserverCandidate) => {
    Alert.alert(
      "Remove observer",
      `${observer.label} will stop getting reminders for ${holiday.name}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setObserves(observer, false),
        },
      ],
    );
  };

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
      {/* `holidayTitle`, which is also what every link to this page sends ahead
          of the read — see `lib/record-title.ts`. */}
      <Stack.Screen options={{ title: holidayTitle(holiday) }} />

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
        {candidates.length === 0 ? (
          <Text style={styles.muted}>
            Add some people first, then come back to say who celebrates.
          </Text>
        ) : (
          <Typeahead
            multi
            label="Add someone"
            value={null}
            options={addable}
            onChange={(c) => c !== null && setObserves(c, true)}
            getKey={(c) => `${c.bearerType}:${c.bearerId}`}
            getLabel={(c) => c.label}
            renderOption={(c) => (
              <Text style={styles.rowText}>
                {c.label}
                {c.bearerType === "pet" ? " (pet)" : ""}
              </Text>
            )}
          />
        )}
        {observers.length === 0 ? (
          <Text style={styles.muted}>No one yet.</Text>
        ) : (
          // Each observer links to their own schedule, because the reminder rule
          // bears on the observance, not the holiday — which is what lets one
          // person get a gift reminder and another only a day-of call.
          observers.map((observer) => (
            <View
              key={`${observer.bearerType}:${observer.bearerId}`}
              style={styles.row}
            >
              <View style={styles.rowMeta}>
                <Link
                  href={`/holidays/${id}/observers/${observer.bearerType}/${observer.bearerId}`}
                >
                  <Text style={[styles.rowText, { color: colors.accent }]}>
                    {observer.label}
                    {observer.bearerType === "pet" ? " (pet)" : ""}
                  </Text>
                </Link>
                <View style={styles.rowActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => removeObserver(observer)}
                  >
                    <Text style={styles.danger}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable accessibilityRole="button" onPress={toggleHidden}>
        <Text style={[styles.link, holiday.hidden ? undefined : styles.danger]}>
          {holiday.hidden ? "Unhide this holiday" : "Hide this holiday"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
