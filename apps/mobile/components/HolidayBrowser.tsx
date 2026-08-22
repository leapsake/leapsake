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
 * Pick holidays out of the catalog — the shared body of the create form's
 * Holidays section ({@link StagedHolidaysSection}) and the "Add holiday" screen
 * a record's page pushes to.
 *
 * **The whole list is on show, and the field narrows it.** Adding used to be a
 * two-character typeahead, which meant a user who didn't already know a
 * holiday's name could not find one at all; browsing is the point and searching
 * is the shortcut. It lives here rather than in either caller because the two
 * paths had drifted apart once before, the create form ending up with the better
 * half of a list the detail page also needed.
 *
 * What it does *not* decide is which holidays are addable or what adding one
 * means. The create form appends to an array it will write later; the screen
 * writes an observance immediately. Both hand in a list they have already
 * filtered — hidden ones out, already-kept ones out — because where that list
 * comes from is exactly what differs between them.
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
        {/* By `testID` for the harness, not by its label: "Search" is also a
            tab, and an empty input carries no accessibility text of its own —
            see the note in `PersonFields`. */}
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
