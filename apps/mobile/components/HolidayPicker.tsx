import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import type { ObservanceBearerType } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { HolidayBrowser } from "./HolidayBrowser";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/**
 * Pick holidays for one person or pet — the screen behind the Holidays section's
 * **Add holiday**, and the body both bearer routes render. The list itself is
 * {@link HolidayBrowser}, shared with the create form so the two paths cannot
 * drift; what this adds is the bearer, and therefore what adding *means*.
 *
 * **There is no Save.** An observance is a boolean about a pair, so there is no
 * draft to lose and nothing to hold back: each tap writes, and the section this
 * returns to is the readback. It is also one tap to undo there, which is the
 * other half of why writing straight through is safe here and not on a form.
 *
 * What this visit added is listed as it goes, so the list shrinking under the
 * user's thumb reads as "that worked" rather than as a row going missing.
 * Hidden holidays never appear — `splitBearerHolidays` keeps them out, since
 * observing one would be a no-op.
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
