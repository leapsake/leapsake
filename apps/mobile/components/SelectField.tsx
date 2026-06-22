import { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { colors, styles } from "../lib/styles";

/**
 * The mobile stand-in for desktop's `<select>` over a short, fully-known list — a
 * milestone Kind or Month, a Gender. Replaces the old wrapping-pill control for
 * these finite enums (pills only read well at a handful of options and gave no
 * affordance for longer ones). Long, possibly-unfamiliar lists (a relationship
 * Role, a Country) stay on the typeahead pattern instead.
 *
 * Renders the real native picker via `@react-native-picker/picker`: on Android a
 * `<Picker>` is already a tap-to-open dropdown dialog, so we show it inline; on
 * iOS the picker is a wheel, so we show a field row with the current label and
 * open the wheel in a Done-dismissable bottom sheet on tap.
 *
 * Generic over the option value so it serves string enums and nullable choices
 * alike. Values are addressed by their index internally, sidestepping the Picker's
 * awkwardness with `null`/`""` sentinels and keeping `onChange` exact.
 */
export function SelectField<T extends string | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? "";

  const picker = (
    <Picker
      selectedValue={String(selectedIndex)}
      onValueChange={(idx) => onChange(options[Number(idx)]!.value)}
      // dropdown is the native Android affordance; ignored on iOS.
      mode="dropdown"
    >
      {options.map((option, i) => (
        <Picker.Item key={i} label={option.label} value={String(i)} />
      ))}
    </Picker>
  );

  // Android: the Picker is itself a labelled, tap-to-open dropdown — show inline.
  if (Platform.OS !== "ios") {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={local.androidPicker}>{picker}</View>
      </View>
    );
  }

  // iOS: a field row showing the current value; tapping reveals the wheel.
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[styles.input, local.row]}
      >
        <Text style={styles.fieldValue}>{selectedLabel}</Text>
        <Text style={local.chevron}>›</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={local.backdrop} onPress={() => setOpen(false)} />
        <View style={local.sheet}>
          <View style={local.doneBar}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
            >
              <Text style={styles.link}>Done</Text>
            </Pressable>
          </View>
          {picker}
        </View>
      </Modal>
    </View>
  );
}

const local = StyleSheet.create({
  androidPicker: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chevron: {
    fontSize: 20,
    color: colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  sheet: {
    backgroundColor: "#ffffff",
    paddingBottom: 24,
  },
  doneBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
