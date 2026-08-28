import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { HolidayListItem } from "@leapsake/core";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";
import { formatOccurrence } from "@leapsake/schema";

// The holiday catalog, ported from desktop's HolidayList: what Leapsake knows
// about, when each next falls, and how many people are attached. The entry point
// to the observer picker, which is where the feature gets its data.
//
// A hidden member of the tab navigator rather than a tab: it's a catalog you
// consult, not a place you live, so the bar stays under it without spending a
// button on it. It's reached from Search's browse list; its title and the
// "Search" link beside it are declared with the bar, in `app/(tabs)/_layout.tsx`.
// A holiday's own page still pushes onto the root stack, over the bar.
//
// Hidden holidays stay listed (sorted last, and marked) rather than filtered
// out — this is the only screen that can unhide one, so removing them would
// strand them. (Search indexes them too, deliberately, for the same reason —
// see `search-service`.)
export default function HolidaysScreen() {
  const core = useCore();
  const load = useCallback(() => core.holidays.list(), [core]);
  const { data, error } = useFocusedData(load);

  return (
    <>
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : data === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList<HolidayListItem>
          contentContainerStyle={styles.screen}
          data={data}
          keyExtractor={(holiday) => holiday.id}
          ListEmptyComponent={
            <Text style={styles.muted}>No holidays yet.</Text>
          }
          renderItem={({ item: holiday }) => (
            /* A view nested in `Link`'s text is dropped from the accessibility
               tree on iOS — see the note in `app/(tabs)/tags.tsx`. */
            <Link
              href={`/holidays/${holiday.id}`}
              style={styles.row}
              accessible
              accessibilityLabel={`${holiday.name}${
                holiday.hidden ? " (hidden)" : ""
              }`}
            >
              <View>
                <Text style={[styles.rowText, { color: colors.accent }]}>
                  {holiday.name}
                  {holiday.hidden ? " (hidden)" : ""}
                </Text>
                <Text style={styles.rowMeta}>
                  {holiday.nextOccurrence === null
                    ? "No upcoming date"
                    : formatOccurrence(holiday.nextOccurrence)}
                  {holiday.observerCount > 0 &&
                    ` · ${holiday.observerCount} ${
                      holiday.observerCount === 1 ? "person" : "people"
                    }`}
                </Text>
              </View>
            </Link>
          )}
        />
      )}
    </>
  );
}
