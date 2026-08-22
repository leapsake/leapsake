import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SearchInput } from "./SearchInput";
import { styles } from "../lib/styles";

/**
 * A free-text value with a short list of usual answers — a contact method's
 * Label ("Mobile", "Home", "Mum's place"). The third picker in the set, and the
 * one for a list that *suggests* rather than constrains: {@link SelectField} is
 * for a finite enum the value must be one of, {@link Typeahead} for a list too
 * long to show unprompted. Here the list is short enough to show whole, and
 * anything you type instead is just as valid an answer.
 *
 * The suggestions used to sit under the field as a row of tappable chips, which
 * put every one of them on the screen permanently — several rows of contact
 * method deep on the person form, that was a lot of page spent on words the user
 * had already chosen between. Behind a sheet they cost one line until asked for.
 *
 * The sheet opens with the current value in its input — the field it edits, not
 * an empty search box — over the suggestions, whole. What has been typed is
 * offered *last*, the same order {@link Typeahead} puts its `createOptions` in
 * and for the same reason: the matches are what the eye should land on first.
 * Nothing commits until a row is tapped (or the keyboard's Done submits typed
 * text), so leaving by the backdrop or Cancel leaves the value alone.
 *
 * Suited to lists of a handful: the sheet takes half the screen and doesn't
 * scroll, so a list too long for that half wanted a `Typeahead`.
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
  /** Harness anchor for the row that opens the sheet — see {@link SelectField}. */
  testID?: string;
}) {
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  /**
   * Whether the query is the user's typing rather than the value the sheet
   * opened with. The input starts *holding the current label* — that is what
   * says "this is the one you have, edit it or pick another" — and a seeded
   * query is not a search: filtering the list down to the answer already given
   * would hide the alternatives the sheet exists to show. So the list stays
   * whole until the first keystroke, and filters from then on.
   */
  const [typing, setTyping] = useState(false);

  const typed = query.trim();
  const q = typed.toLowerCase();
  const matches = typing
    ? suggestions.filter((suggestion) => suggestion.toLowerCase().includes(q))
    : suggestions;
  // Offering "Use Work" under a listed Work would be two rows doing one thing,
  // and offering the value the field already holds would be a row doing none.
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
        // The row shows the value alone, so without this a screen reader
        // announces "Mobile, button" with nothing saying what is Mobile.
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

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        {/* The sheet is pinned to the bottom of the screen, which is where the
            keyboard arrives — without this the field being typed into is the
            one thing the keyboard covers. */}
        <KeyboardAvoidingView
          style={local.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.sheetBackdrop} onPress={close} />
          {/* Half the screen even when three suggestions don't fill it: a sheet
              sized to its rows opens as a strip at the bottom edge, which reads
              as a toast that landed rather than as a place you are now in.
              Whitespace under the last row is the cheaper half of that trade. */}
          <View style={[styles.sheet, { minHeight: height / 2 }]}>
            <View style={styles.sheetBar}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable accessibilityRole="button" onPress={close}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            </View>

            <View style={local.body}>
              {/* The same field the Search tab wears, for the same reason: this
                  one filters the list under it too. */}
              <SearchInput
                value={query}
                onChangeText={(next) => {
                  setQuery(next);
                  setTyping(true);
                }}
                placeholder={`Type a ${label.toLowerCase()}`}
                // The placeholder goes as soon as there is a value, and the
                // sheet's title is a heading rather than this field's name.
                accessibilityLabel={label}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (typed !== "") choose(typed);
                }}
              />

              {/* Nothing marks the suggestion the field is already on: the
                  input above is showing it, and a bolded row in a list of
                  choices reads as a heading over them rather than as one of
                  them. The selected state is still announced. */}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const local = StyleSheet.create({
  fill: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
