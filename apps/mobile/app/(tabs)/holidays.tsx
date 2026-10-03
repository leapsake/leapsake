import { useCallback } from "react";
import { FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { HolidayListItem } from "@leapsake/core";
import { useCore } from "../../lib/core-context";
import { holidayHref } from "../../lib/record-title";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";
import { formatOccurrence } from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { LoadState } from "../../components/LoadState";

// The holiday catalog. Hidden holidays stay listed, last and marked, since
// this is the only screen that can unhide one.
export default function HolidaysScreen() {
  const core = useCore();
  const m = useMessages();
  const load = useCallback(() => core.holidays.list(), [core]);
  const { data, error } = useFocusedData(load);

  return (
    <>
      {error !== null || data === null ? (
        <LoadState error={error} />
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
              href={holidayHref(holiday)}
              style={styles.row}
              testID="holiday-row"
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
                  {m.holidays.rowMeta(
                    holiday.nextOccurrence === null
                      ? null
                      : formatOccurrence(holiday.nextOccurrence),
                    holiday.observerCount,
                  )}
                </Text>
              </View>
            </Link>
          )}
        />
      )}
    </>
  );
}
