import { useCallback, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import type { ObservanceBearerType } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { HolidayBrowser } from "./HolidayBrowser";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";
import { LoadState } from "./LoadState";

/**
 * Add holidays for one bearer, each tap writing at once with no Save. What
 * this visit added is listed, so a shrinking list reads as success.
 */
export function HolidayPicker({
  bearerType,
  bearerId,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
}) {
  const core = useCore();
  const load = useCallback(
    () => core.holidays.listForBearer(bearerType, bearerId),
    [core, bearerType, bearerId],
  );
  const { data, error, reload } = useFocusedData(load);
  const [added, setAdded] = useState<string[]>([]);

  function add(holidayId: string, name: string) {
    core.holidays
      .setObservers(holidayId, [{ bearerType, bearerId, observes: true }])
      .then(
        () => {
          setAdded((names) => [...names, name]);
          return reload();
        },
        (e: unknown) => Alert.alert("Couldn't add", String(e)),
      );
  }

  if (error !== null || data === null) return <LoadState error={error} />;

  const { addable } = splitBearerHolidays(data);

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {added.length > 0 && (
        <Text style={styles.muted} accessibilityRole="summary">
          Added {added.join(", ")}.
        </Text>
      )}

      <HolidayBrowser
        addable={addable}
        onAdd={(holiday) => add(holiday.id, holiday.name)}
      />
    </ScrollView>
  );
}
