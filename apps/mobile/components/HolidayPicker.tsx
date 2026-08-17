import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ObservanceBearerType } from "@leapsake/schema";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/**
 * Pick holidays for one person or pet — the screen behind the Holidays section's
 * "Add holiday", and the body both bearer routes render.
 *
 * It replaced a typeahead that sat inside the section itself. On a section that
 * field was the only way in, and it only ever listed anything once two characters
 * were typed, so a user who didn't already know a holiday's name couldn't find it
 * at all. A screen can afford to show the whole catalog and let the filter be
 * optional, which is the difference between browsing and guessing.
 *
 * Adding writes straight through (`setObservers`) rather than collecting a
 * selection to confirm: the section this returns to is the readback, and every
 * add is one tap to undo there. Hidden holidays never appear — `splitBearerHolidays`
 * keeps them out, since observing one would be a no-op.
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
  const [query, setQuery] = useState("");
  // What this visit added, kept so the list shrinking under the user's thumb
  // reads as "that worked" rather than as a row going missing.
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
  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? addable
      : addable.filter((h) => h.name.toLowerCase().includes(q));

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Search</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>

      {added.length > 0 && (
        <Text style={styles.muted} accessibilityRole="summary">
          Added {added.join(", ")}.
        </Text>
      )}

      {matches.length === 0 ? (
        <Text style={styles.muted}>
          {addable.length === 0
            ? "Every holiday is already on this list."
            : "No holidays match."}
        </Text>
      ) : (
        matches.map((holiday) => (
          <View key={holiday.id} style={styles.row}>
            <Text style={styles.rowText}>{holiday.name}</Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>
                {holiday.nextOccurrence === null
                  ? "—"
                  : formatOccurrence(holiday.nextOccurrence)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => add(holiday.id, holiday.name)}
              >
                <Text style={styles.link}>Add</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
