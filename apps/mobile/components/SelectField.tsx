import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { colors, radius, styles } from "../lib/styles";
import { Sheet } from "./Sheet";

/**
 * A short, finite enum as the native picker (the app's README → Form
 * controls). Indexed internally, since the Picker mishandles `null` and `""`.
 */
export function SelectField<T extends string | null>({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Anchors the control that opens the field: iOS exposes no wheel options. */
  testID?: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? "";

  const picker = (
    <Picker
      // On Android the Picker is what opens; on iOS the field row below is.
      testID={Platform.OS === "ios" ? undefined : testID}
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

  // Android: the Picker is itself a labelled, tap-to-open dropdown — show
  // inline.
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
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[styles.input, styles.pickerRow]}
      >
        <Text style={styles.fieldValue}>{selectedLabel}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {/* The wheel says what the field is, so the bar holds only Done. */}
      <Sheet visible={open} onClose={() => setOpen(false)} close="done">
        {picker}
      </Sheet>
    </View>
  );
}

const local = StyleSheet.create({
  androidPicker: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
});
