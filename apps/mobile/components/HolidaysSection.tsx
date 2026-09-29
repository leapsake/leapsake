import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { BearerHolidayCandidate } from "@leapsake/core";
import type { ObservanceBearerType } from "@leapsake/schema";
import { formatOccurrence } from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { splitBearerHolidays } from "@leapsake/view-models";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * The holidays someone observes, each written at once with no Save, and
 * linking to that observance's own reminder schedule.
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
  /** Refetch the page — clearing an observance writes where it stands. */
  onChanged: () => void;
}) {
  const core = useCore();
  // Only what this bearer keeps; what is addable is the picker's business.
  const { observed } = splitBearerHolidays(holidays);

  function confirmRemove(holiday: BearerHolidayCandidate) {
    Alert.alert("Remove holiday", `Remove ${holiday.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          core.holidays
            .setObservers(holiday.id, [
              { bearerType, bearerId, observes: false },
            ])
            .then(
              () => onChanged(),
              (e: unknown) => Alert.alert("Couldn't remove", String(e)),
            );
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Holidays</Text>
        <Link
          href={`${entityBasePath(bearerType)}/${bearerId}/holidays/new`}
          style={styles.link}
        >
          Add holiday
        </Link>
      </View>

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
                  accessibilityLabel={`Remove ${holiday.name}`}
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
