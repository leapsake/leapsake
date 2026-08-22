import { type ReactNode, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SearchInput } from "./SearchInput";
import { styles } from "../lib/styles";

/**
 * One value out of a **long closed list**, chosen in a sheet — the fourth picker
 * in the set, and the one for a list that is neither short enough to show whole
 * nor open to anything you type. {@link SelectField} is for a finite enum small
 * enough for the native wheel, {@link SuggestField} for free text over a handful
 * of usual answers, {@link Typeahead} for a long list picked *inline*, where the
 * field can afford the width its matches need.
 *
 * This exists because that last condition can fail. A relationship's Role shares
 * its line with the Name it qualifies ({@link RelationshipFields}), the way a
 * contact method's Label shares one with the address it names, and a third of a
 * phone's width is not somewhere forty role names can be listed. Collapsed to a
 * row it costs one line; the list gets the sheet, which is the whole width and
 * scrolls.
 *
 * **The filter is the Search tab's own field**, as it is in a
 * {@link SuggestField}'s sheet and for the same reason: it filters a list under
 * it, so it should look like the other thing in this app that does. Unlike a
 * `Typeahead` the list shows *whole* until the first keystroke — a sheet the
 * user has deliberately opened is a place to browse, and there is no cost to
 * showing everything when nothing else is on screen.
 *
 * Nothing commits until a row is tapped, so leaving by the backdrop or Cancel
 * leaves the value alone.
 */
export function PickerField<T>({
  label,
  value,
  options,
  onChange,
  getKey,
  getLabel,
  renderOption,
  placeholder,
  emptyText = "No matches.",
  testID,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T) => void;
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  renderOption?: (option: T) => ReactNode;
  /** Stand-in shown when nothing is chosen. Defaults to the field's label. */
  placeholder?: string;
  /** Said when the filter matches nothing — or when there is nothing to match. */
  emptyText?: string;
  /** Harness anchor for the row that opens the sheet — see {@link SelectField}. */
  testID?: string;
}) {
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? options
      : options.filter((o) => getLabel(o).toLowerCase().includes(q));

  const chosen = value === null ? "" : getLabel(value);

  function openSheet() {
    // Opens on the whole list every time, rather than filtered to the answer
    // already given — that would hide the alternatives the sheet is for.
    setQuery("");
    setOpen(true);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // The row shows the value alone, so without this a screen reader
        // announces "Sister, button" with nothing saying what is Sister.
        accessibilityLabel={`${label}: ${chosen === "" ? "none" : chosen}`}
        onPress={openSheet}
        style={[styles.input, styles.pickerRow]}
      >
        <Text
          style={[styles.fieldValue, chosen === "" && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {chosen === "" ? (placeholder ?? label) : chosen}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        {/* **No `KeyboardAvoidingView`**, unlike a {@link SuggestField}'s sheet.
            That one is half a screen with its input near the bottom edge, so the
            keyboard lands on the very field being typed into and the sheet has
            to be lifted clear. Here the filter is at the *top* of a sheet three
            quarters of a screen tall — already well above the keyboard — and
            lifting it only pushed the title bar up under the status bar, since
            the backdrop that pins this to the bottom had nothing left to give.
            The keyboard covers the tail of a list that scrolls, which is what
            every search-in-a-sheet on the platform does. */}
        <>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setOpen(false)}
          />
          {/* Taller than a `SuggestField`'s half-screen: this list is long
              enough that half a phone would show a handful of forty and read as
              a scrap of the answer rather than the answer. */}
          <View style={[styles.sheet, { height: height * 0.75 }]}>
            <View style={styles.sheetBar}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
              >
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            </View>

            <View style={local.body}>
              <SearchInput
                testID={testID === undefined ? undefined : `${testID}-filter`}
                value={query}
                onChangeText={setQuery}
                placeholder={`Find a ${label.toLowerCase()}`}
                // The placeholder goes as soon as there is a value, and the
                // sheet's title is a heading rather than this field's name.
                accessibilityLabel={label}
              />
            </View>

            {/* Scrolls, which is the other half of why this is not a
                `SuggestField`: its sheet is sized to a handful and doesn't. */}
            <ScrollView
              style={local.list}
              contentContainerStyle={local.body}
              keyboardShouldPersistTaps="handled"
            >
              {matches.length === 0 ? (
                <Text style={styles.muted}>{emptyText}</Text>
              ) : (
                matches.map((option) => (
                  <Pressable
                    key={getKey(option)}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected:
                        value !== null && getKey(option) === getKey(value),
                    }}
                    style={styles.row}
                    onPress={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    {renderOption ? (
                      renderOption(option)
                    ) : (
                      <Text style={styles.rowText}>{getLabel(option)}</Text>
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </>
      </Modal>
    </View>
  );
}

const local = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  /** Takes what the bar and the filter leave, which is what makes it scroll. */
  list: {
    flex: 1,
  },
});
