import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatOccurrence } from "@leapsake/schema";
import { styles } from "../lib/styles";

/** The little a browsable holiday has to be: a name, a date, and an id. */
export interface BrowsableHoliday {
  id: string;
  name: string;
  nextOccurrence: string | null;
}

/**
 * The whole catalog on show, narrowed by a field, for both ways of adding a
 * holiday; each caller decides what is addable and what adding means.
 */
export function HolidayBrowser<T extends BrowsableHoliday>({
  addable,
  onAdd,
}: {
  /** The catalog minus what this bearer already keeps, and minus the hidden. */
  addable: readonly T[];
  onAdd: (holiday: T) => void;
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? addable
      : addable.filter((h) => h.name.toLowerCase().includes(q));

  return (
    <>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Search</Text>
        {/* An E2E anchor: "Search" is also a tab, and an empty input has no
            accessibility text. */}
        <TextInput
          testID="holiday-search"
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>

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
                accessibilityLabel={`Add ${holiday.name}`}
                onPress={() => onAdd(holiday)}
              >
                <Text style={styles.link}>Add</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </>
  );
}
