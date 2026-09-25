import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { DateParts } from "../lib/date-parts";
import { colors, styles } from "../lib/styles";

const PART_LABELS = { month: "Month", day: "Day", year: "Year" } as const;

const PARTS = ["month", "day", "year"] as const;

type Part = (typeof PARTS)[number];

/**
 * A date typed as three numbers, month then day then year, under one heading.
 * Controlled and rule-free: the caller decides what is wrong, and the error
 * shows only once focus has left all three fields.
 */
export function DatePartsFields({
  label,
  value,
  onChange,
  testIDPrefix,
  error = null,
}: {
  /** The heading over the three fields. */
  label: string;
  value: DateParts;
  onChange: (next: DateParts) => void;
  /** Each field is `${testIDPrefix}-month`, `-day` and `-year`. */
  testIDPrefix: string;
  /** What is wrong with the date as typed, or null. */
  error?: string | null;
}) {
  const [focused, setFocused] = useState<Part | null>(null);
  const [blurred, setBlurred] = useState(false);
  const showError = error !== null && blurred && focused === null;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={local.row}>
        {PARTS.map((part) => (
          <View key={part} style={part === "year" ? local.wide : local.narrow}>
            {/* Hidden because the input below carries the same words as its name. */}
            <Text
              style={styles.fieldLabel}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {PART_LABELS[part]}
            </Text>
            <TextInput
              testID={`${testIDPrefix}-${part}`}
              accessibilityLabel={PART_LABELS[part]}
              style={[styles.input, showError && local.invalid]}
              value={value[part]}
              onChangeText={(text) => onChange({ ...value, [part]: text })}
              onFocus={() => setFocused(part)}
              onBlur={() => {
                setFocused((current) => (current === part ? null : current));
                setBlurred(true);
              }}
              keyboardType="number-pad"
              maxLength={part === "year" ? 4 : 2}
            />
          </View>
        ))}
      </View>
      {showError ? <Text style={styles.muted}>{error}</Text> : null}
    </View>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  narrow: { flex: 1, gap: 2 },
  wide: { flex: 1.5, gap: 2 },
  invalid: { borderColor: colors.danger },
});
