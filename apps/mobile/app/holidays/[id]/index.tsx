import { useCallback } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { CheckboxBox } from "../../../components/Checkbox";
import { rowMenuItem } from "../../../components/RowMenu";
import { SummaryRow } from "../../../components/SummaryRow";
import { Typeahead } from "../../../components/Typeahead";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { holidayTitle } from "../../../lib/record-title";
import { colors, styles } from "../../../lib/styles";
import { formatOccurrence } from "@leapsake/schema";
import { LoadState } from "../../../components/LoadState";

// A holiday's dates and observers. No edit: catalog rows are read-only
// (`@leapsake/holidays` README).
export default function HolidayDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(
    () => Promise.all([core.holidays.get(id), core.holidays.listObservers(id)]),
    [core, id],
  );
  const { data, error, reload } = useFocusedData(load);

  if (error !== null || data === null) return <LoadState error={error} />;

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

  // One read for observers and candidates; an observer is never suggested.
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

  const toggleHidden = () => {
    core.holidays
      .setHidden(id, !holiday.hidden)
      .then(reload, (e: unknown) => Alert.alert("Couldn't save", String(e)));
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* `holidayTitle`, which every link to this page also sends ahead. */}
      <Stack.Screen options={{ title: holidayTitle(holiday) }} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming</Text>
        {holiday.upcoming.length === 0 ? (
          // Past its table, or an unknown rule: no date rather than a guess.
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
          // Reminder rules are per observance, so each observer has a schedule.
          observers.map((observer) => (
            <SummaryRow
              key={`${observer.bearerType}:${observer.bearerId}`}
              title={
                <Link
                  href={`/holidays/${id}/observers/${observer.bearerType}/${observer.bearerId}`}
                >
                  <Text style={[styles.rowText, { color: colors.accent }]}>
                    {observer.label}
                    {observer.bearerType === "pet" ? " (pet)" : ""}
                  </Text>
                </Link>
              }
              menu={{
                subject: observer.label,
                items: [
                  rowMenuItem.reminders(() =>
                    router.push(
                      `/holidays/${id}/observers/${observer.bearerType}/${observer.bearerId}`,
                    ),
                  ),
                  rowMenuItem.remove(() => removeObserver(observer)),
                ],
              }}
            />
          ))
        )}
      </View>

      <View style={styles.field}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: holiday.hidden }}
          style={styles.rowWithLead}
          onPress={toggleHidden}
        >
          <CheckboxBox checked={holiday.hidden} />
          <Text style={styles.fieldValue}>Hide this holiday</Text>
        </Pressable>
        <Text style={styles.muted}>
          A hidden holiday produces no reminders. Your saved answers about who
          observes it are kept.
        </Text>
      </View>
    </ScrollView>
  );
}
