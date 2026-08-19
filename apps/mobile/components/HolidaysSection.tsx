import { Text, View } from "react-native";
import { Link } from "expo-router";
import type { BearerHolidayCandidate } from "@leapsake/core";
import type { ObservanceBearerType } from "@leapsake/schema";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { styles } from "../lib/styles";

/**
 * The Holidays section on the Person and Pet screens, ported from the desktop
 * `HolidaysSection` — the mirror of the "Observed by" field on a holiday.
 * Observing from either direction writes the same row, so which surface a user
 * reaches for is only a matter of what they're looking at.
 *
 * Which holidays this bearer keeps is decided on the form behind the page's one
 * Edit ({@link StagedHolidaysSection}). What stays here is the row's link to that
 * observance's **reminder schedule**, which is neither the holiday's nor the
 * bearer's but the pair's: two people who observe the same holiday can be
 * reminded about entirely different things, and the rule only exists once the
 * observance does.
 */
export function HolidaysSection({
  bearerType,
  bearerId,
  holidays,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
  holidays: BearerHolidayCandidate[];
}) {
  // Only what this bearer keeps: what it could still be offered is the edit
  // form's business (see `splitBearerHolidays`).
  const { observed } = splitBearerHolidays(holidays);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Holidays</Text>
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
              <Link
                href={`/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`}
                style={styles.link}
              >
                Reminders
              </Link>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
