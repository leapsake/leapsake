import { Pressable, Text, View, StyleSheet } from "react-native";
import { type Gender, genderLabel } from "@leapsake/schema";
import { colors } from "../lib/styles";

// The gender values in the same order the desktop <select> shows them, with a
// leading "unset" (null) option. A zero-dependency segmented control of pills,
// standing in for desktop's `<select>` without pulling in a native picker.
const options: { value: Gender | null; label: string }[] = [
  { value: null, label: "—" },
  { value: "female", label: genderLabel.female },
  { value: "male", label: genderLabel.male },
  { value: "nonbinary", label: genderLabel.nonbinary },
];

export function GenderField({
  value,
  onChange,
}: {
  value: Gender | null;
  onChange: (value: Gender | null) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Gender</Text>
      <View style={styles.pills}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value ?? "unset"}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text
                style={[styles.pillText, selected && styles.pillTextSelected]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillSelected: {
    backgroundColor: colors.selectedBg,
    borderColor: colors.selectedBg,
  },
  pillText: {
    fontSize: 15,
    color: colors.text,
  },
  pillTextSelected: {
    color: colors.selectedText,
  },
});
