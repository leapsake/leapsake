import { Pressable, Text, View, StyleSheet } from "react-native";
import type { EntityType } from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

/**
 * Person / Pet, as a two-segment pill — the head of the combined create form
 * (app/add.tsx), which replaced the chooser screen that used to ask the same
 * question with two full-width buttons.
 *
 * Note that {@link SelectField} records the retirement of a wrapping-pill control
 * for finite enums, on the grounds that "pills only read well at a handful of
 * options and gave no affordance for longer ones". Two options is that handful,
 * and both are visible at once with the chosen one filled — which is the whole
 * point here, since the choice reshapes the form beneath it. Anything longer
 * still belongs in a `SelectField` or a `Typeahead`.
 */
export function EntityTypeToggle({
  value,
  onChange,
}: {
  value: EntityType;
  onChange: (value: EntityType) => void;
}) {
  return (
    <View style={local.group} accessibilityRole="tablist">
      {(["person", "pet"] as const).map((type) => {
        const selected = type === value;
        return (
          <Pressable
            key={type}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(type)}
            style={[local.segment, selected && local.segmentSelected]}
          >
            <Text
              style={[
                styles.fieldValue,
                local.segmentText,
                selected && { color: colors.selectedText },
              ]}
            >
              {type === "person" ? "Person" : "Pet"}
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
