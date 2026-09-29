import { Pressable, Text, View, StyleSheet } from "react-native";
import { colors, styles } from "../lib/styles";

/**
 * Two or three segments, all visible, the chosen one filled: for a question
 * whose answer reshapes the form beneath it (the app's README).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <View style={local.group} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[local.segment, selected && local.segmentSelected]}
          >
            <Text
              style={[
                styles.fieldValue,
                local.segmentText,
                selected && { color: colors.selectedText },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  group: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 8,
  },
  segmentSelected: {
    backgroundColor: colors.selectedBg,
  },
  segmentText: {
    textAlign: "center",
    fontWeight: "600",
  },
});
