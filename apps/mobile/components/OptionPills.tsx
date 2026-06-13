import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/styles";

/**
 * A zero-dependency, single-select segmented control of wrapping pills — the
 * mobile stand-in for the desktop's `<select>`, without pulling in a native
 * picker. Generic over the option value so it serves both string enums (a
 * milestone kind) and nullable choices (a gender, an unset month). Originally
 * extracted from `GenderField`'s pill pattern and now shared by the milestone
 * Kind and Month pickers.
 */
export function OptionPills<T extends string | null>({
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
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
