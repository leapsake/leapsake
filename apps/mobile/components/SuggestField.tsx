import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SearchInput } from "./SearchInput";
import { Sheet } from "./Sheet";
import { styles } from "../lib/styles";

/**
 * Free text with a handful of usual answers, in a sheet that opens holding
 * the current value (the app's README → Form controls).
 */
export function SuggestField({
  label,
  value,
  suggestions,
  placeholder,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  /** The usual answers, listed in the sheet in this order. */
  suggestions: readonly string[];
  /** Stand-in shown when the value is empty. Defaults to the field's label. */
  placeholder?: string;
  onChange: (value: string) => void;
  /** Anchors the row that opens the sheet; see {@link SelectField}. */
  testID?: string;
}) {
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // The seeded value is no search: the list stays whole until a keystroke,
  // or it would hide the alternatives the sheet exists to show.
  const [typing, setTyping] = useState(false);

  const typed = query.trim();
  const q = typed.toLowerCase();
  const matches = typing
    ? suggestions.filter((suggestion) => suggestion.toLowerCase().includes(q))
    : suggestions;
  // Not when it repeats a suggestion, or the value already held.
  const offerTyped =
    typed !== "" &&
    typed !== value.trim() &&
    !suggestions.some((suggestion) => suggestion.toLowerCase() === q);

  function openSheet() {
    setQuery(value);
    setTyping(false);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function choose(next: string) {
    onChange(next);
    close();
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // The row shows the value alone, so this names the field too.
        accessibilityLabel={`${label}: ${value === "" ? "none" : value}`}
        onPress={openSheet}
        style={[styles.input, styles.pickerRow]}
      >
        <Text
          style={[styles.fieldValue, value === "" && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {value === "" ? (placeholder ?? label) : value}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {/* Pinned to the bottom, where the keyboard would cover the field;
          half the screen however few rows, or it reads as a toast. */}
      <Sheet
        visible={open}
        onClose={close}
        close="cancel"
        title={label}
        avoidKeyboard
        style={{ minHeight: height / 2 }}
      >
        <View style={local.body}>
          <SearchInput
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              setTyping(true);
            }}
            placeholder={`Type a ${label.toLowerCase()}`}
            // A placeholder leaves the accessible name once there is a
            // value.
            accessibilityLabel={label}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (typed !== "") choose(typed);
            }}
          />

          {/* The current value is not bolded (it would read as a heading),
                  only announced as selected. */}
          {matches.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityState={{ selected: suggestion === value }}
              style={styles.row}
              onPress={() => choose(suggestion)}
            >
              <Text style={styles.rowText}>{suggestion}</Text>
            </Pressable>
          ))}

          {offerTyped ? (
            <Pressable
              accessibilityRole="button"
              style={styles.row}
              onPress={() => choose(typed)}
            >
              <Text style={styles.rowText}>Use “{typed}”</Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

const local = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
