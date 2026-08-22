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
 * The Holidays section on the Person and Pet screens, ported from the desktop
 * `HolidaysSection` — the mirror of the "Observed by" field on a holiday.
 * Observing from either direction writes the same row, so which surface a user
 * reaches for is only a matter of what they're looking at.
 *
 * **Both directions write immediately, with no Save.** An observance is a
 * boolean about a pair — there is no draft to lose, no half-said state to hold
 * back, and each is one tap to reverse from the other side. So Add pushes the
 * catalog ({@link HolidayPicker}) and Remove clears the answer in place, which
 * is the same `setObservers` call with the other value.
 *
 * The row's other link is the observance's **reminder schedule**, which is
 * neither the holiday's nor the bearer's but the pair's: two people who observe
 * the same holiday can be reminded about entirely different things, and the rule
 * only exists once the observance does.
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
  // Only what this bearer keeps: what they could still be offered is the
  // picker's business (see `splitBearerHolidays`).
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
