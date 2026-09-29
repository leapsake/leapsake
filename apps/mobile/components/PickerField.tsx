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
 * One value from a long closed list, in a sheet, for a field too narrow for
 * a `Typeahead` (the app's README → Form controls).
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
  /** Said when the filter matches nothing, or there is nothing to match. */
  emptyText?: string;
  /** Anchors the row that opens the sheet; see {@link SelectField}. */
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
    // Opens on the whole list, not filtered to the answer already given.
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
        // The row shows the value alone, so this names the field too.
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
        {/* No `KeyboardAvoidingView`: the filter sits high, and lifting the
            sheet pushed its bar under the status bar. */}
        <>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setOpen(false)}
          />
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
                // A placeholder leaves the accessible name once there is a
                // value.
                accessibilityLabel={label}
              />
            </View>

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
                    // Its label is a decoy twice over: the filter and Gboard's
                    // suggestion strip both show it (maestro/README.md).
                    testID={
                      testID === undefined
                        ? undefined
                        : `${testID}-option-${getKey(option)}`
                    }
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
