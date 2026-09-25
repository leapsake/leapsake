import { StyleSheet, Text, TextInput, View } from "react-native";
import type { DateParts } from "../lib/date-parts";
import { colors, styles } from "../lib/styles";

const PART_LABELS = { month: "Month", day: "Day", year: "Year" } as const;

const PARTS = ["month", "day", "year"] as const;

/**
 * A date typed as three numbers, month then day then year, under one heading.
 * Controlled and rule-free: which parts are required, and what counts as valid,
 * is the caller's.
 */
export function DatePartsFields({
  label,
  value,
  onChange,
  accessibilityLabels,
  testIDPrefix,
  invalid = false,
}: {
  /** The heading over the three fields. */
  label: string;
  value: DateParts;
  onChange: (next: DateParts) => void;
  /** What a screen reader calls each field; the visible captions are hidden from it. */
  accessibilityLabels: Record<keyof DateParts, string>;
  /** Each field is `${testIDPrefix}-month`, `-day` and `-year`. */
  testIDPrefix: string;
  /** Outline the fields as refused. */
  invalid?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={local.row}>
        {PARTS.map((part) => (
          <View key={part} style={part === "year" ? local.wide : local.narrow}>
            <Text
              style={styles.fieldLabel}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {PART_LABELS[part]}
            </Text>
            <TextInput
              testID={`${testIDPrefix}-${part}`}
              accessibilityLabel={accessibilityLabels[part]}
              style={[styles.input, invalid && local.invalid]}
              value={value[part]}
              onChangeText={(text) => onChange({ ...value, [part]: text })}
              keyboardType="number-pad"
              maxLength={part === "year" ? 4 : 2}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  narrow: { flex: 1, gap: 2 },
  wide: { flex: 1.5, gap: 2 },
  invalid: { borderColor: colors.danger },
});
