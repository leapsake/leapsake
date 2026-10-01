import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { DateParts } from "@leapsake/schema";
import { datePartFinished } from "../lib/date-parts";
import { colors, styles } from "../lib/styles";

const PART_LABELS = { month: "Month", day: "Day", year: "Year" } as const;

const PARTS = ["month", "day", "year"] as const;

type Part = (typeof PARTS)[number];

/** A date as month, day and year under one heading; the caller's error
 *  shows once focus has left all three. */
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
  const inputs = useRef<Partial<Record<Part, TextInput | null>>>({});
  const screenReader = useScreenReader();

  // Without a screen reader, typing flows on and Backspace flows back.
  const edit = (part: Part, text: string) => {
    onChange({ ...value, [part]: text });
    const next = PARTS[PARTS.indexOf(part) + 1];
    const grew = text.length > value[part].length;
    if (screenReader || next === undefined || !grew) return;
    if (datePartFinished(part, text) && value[next] === "") {
      inputs.current[next]?.focus();
    }
  };

  const stepBack = (part: Part) => {
    const previous = PARTS[PARTS.indexOf(part) - 1];
    if (screenReader || previous === undefined || value[part] !== "") return;
    onChange({ ...value, [previous]: value[previous].slice(0, -1) });
    inputs.current[previous]?.focus();
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={local.row}>
        {PARTS.map((part) => (
          <View key={part} style={part === "year" ? local.wide : local.narrow}>
            {/* Hidden: the input below carries these words as its name. */}
            <Text
              style={styles.fieldLabel}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {PART_LABELS[part]}
            </Text>
            <TextInput
              ref={(input) => {
                inputs.current[part] = input;
              }}
              testID={`${testIDPrefix}-${part}`}
              accessibilityLabel={PART_LABELS[part]}
              style={[styles.input, showError && local.invalid]}
              value={value[part]}
              onChangeText={(text) => edit(part, text)}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === "Backspace") stepBack(part);
              }}
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

function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setEnabled);
    const sub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setEnabled,
    );
    return () => sub.remove();
  }, []);
  return enabled;
}

const local = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  narrow: { flex: 1, gap: 2 },
  wide: { flex: 1.5, gap: 2 },
  invalid: { borderColor: colors.danger },
});
