import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { BearerHolidayCandidate } from "@leapsake/core";
import type { ObservanceBearerType } from "@leapsake/schema";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

/**
 * The Holidays section on the Person and Pet screens, ported from the desktop
 * `HolidaysSection` — the mirror of the "Observed by" field on a holiday.
 * Adding an observance from either direction writes the same row, so which
 * surface a user reaches for is only a matter of what they're looking at.
 *
 * Each row links to that observance's reminder schedule rather than editing
 * anything here, because the reminder rule bears on the *observance*: two people
 * who observe the same holiday can be reminded about entirely different things.
 */
export function HolidaysSection({
  bearerType,
  bearerId,
  holidays,
  onChanged,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
  holidays: BearerHolidayCandidate[];
  onChanged: () => void;
}) {
  const core = useCore();

  // What this bearer keeps, and what it can still be offered — hidden holidays
  // are deliberately absent from the second (see `splitBearerHolidays`).
  const { observed, addable } = splitBearerHolidays(holidays);

  function setObserves(holidayId: string, observes: boolean) {
    core.holidays
      .setObservers(holidayId, [{ bearerType, bearerId, observes }])
      .then(
        () => onChanged(),
        (e: unknown) => Alert.alert("Couldn't save", String(e)),
      );
  }

  function confirmRemove(holiday: BearerHolidayCandidate) {
    Alert.alert(
      "Remove holiday",
      `Stop getting reminders for ${holiday.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setObserves(holiday.id, false),
        },
      ],
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Holidays</Text>
      </View>

      <Typeahead
        multi
        label="Add a holiday"
        value={null}
        options={addable}
        onChange={(h) => h !== null && setObserves(h.id, true)}
        getKey={(h) => h.id}
        getLabel={(h) => h.name}
        placeholder="Search holidays…"
      />

      {observed.length === 0 ? (
        <Text style={styles.muted}>No holidays yet.</Text>
      ) : (
        observed.map((holiday) => (
          <View key={holiday.id} style={styles.row}>
            <Text style={styles.rowText}>
              {holiday.name}
              {holiday.hidden ? " (hidden)" : ""}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>
                {holiday.nextOccurrence === null
                  ? "—"
                  : formatOccurrence(holiday.nextOccurrence)}
              </Text>
              <View style={styles.rowActions}>
                <Link
                  href={`/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`}
                  style={styles.link}
                >
                  Reminders
                </Link>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmRemove(holiday)}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
