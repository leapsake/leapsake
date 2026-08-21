import { Pressable, Text, View, StyleSheet } from "react-native";
import { colors, styles } from "../lib/styles";

/**
 * A two-or-three-segment pill: every option visible at once with the chosen one
 * filled. Extracted from {@link EntityTypeToggle}, which drew it first, once the
 * gift capture form needed the same control for the same reason.
 *
 * Note that {@link SelectField} records the retirement of a wrapping-pill control
 * for finite enums, on the grounds that "pills only read well at a handful of
 * options and gave no affordance for longer ones". This is for the case that
 * survived that: a **question whose answer reshapes the form beneath it**, where
 * seeing both answers side by side is the point. Anything longer, or anything
 * that is merely a field, still belongs in a `SelectField` or a `Typeahead`.
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
