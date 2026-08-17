import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import type { HolidayListItem } from "@leapsake/core";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";
import { formatOccurrence } from "@leapsake/schema";

// The holiday catalog, ported from desktop's HolidayList: what Leapsake knows
// about, when each next falls, and how many people are attached. The entry point
// to the observer picker, which is where the feature gets its data.
//
// A root-stack screen rather than a tab: it's a catalog you consult, not a place
// you live. It's reached from Search's browse list, and pushes full-screen over
// the tab bar like every other non-tab route.
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
      <Stack.Screen options={{ title: "Holidays" }} />
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
            <Link href={`/holidays/${holiday.id}`} style={styles.row}>
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
