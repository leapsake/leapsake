import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { todayCivil } from "@leapsake/schema";
import {
  type DateFields,
  type GiftAdornmentKind,
  whenChoices,
  whenKeyOf,
} from "@leapsake/ui/headless";
import { colors, styles } from "../lib/styles";

/** The month and day of an ISO date, in the reader's locale — "Dec 25". */
function monthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * When a gift is for, or was given — a row of taps rather than three number
 * inputs.
 *
 * This was year/month/day, always visible, in all four places a gift can name an
 * occasion; on a form with two recipients that was five sets of three number
 * pads. But the answer is almost never an arbitrary date. It is *the occasion*,
 * in one of a couple of plausible years, and which years those are depends on
 * which way the field points in time — so `whenChoices` offers them (looking
 * forward for a suggestion, back for a giving) and the triple moves behind
 * "Pick a date…".
 *
 * The triple opens by itself for a date the shortcuts cannot say (`whenKeyOf`
 * returning null): a stored date being edited, a past target, a specific day. A
 * date is never hidden behind a row that can't express it.
 *
 * `fills` is the occasion's own date(s) in the chosen year, which only its
 * holiday knows — offered as further taps rather than applied, since a lunisolar
 * holiday can fall **twice** in one Gregorian year and neither is assumable.
 */
export function WhenField({
  kind,
  date,
  onChange,
  fills,
}: {
  kind: GiftAdornmentKind;
  date: DateFields;
  onChange: (date: DateFields) => void;
  /** ISO dates the occasion resolves to in the chosen year; see above. */
  fills: readonly string[];
}) {
  const choices = whenChoices(kind, todayCivil());
  const picked = whenKeyOf(date, choices);
  // Seeded from the date the field opened on, then owned by the user: they may
  // open the triple on a shortcut date to adjust it, and it must not snap shut
  // underneath them when their edit happens to land back on a shortcut.
  const [custom, setCustom] = useState(picked === null);
  const open = custom || picked === null;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>When?</Text>

      <View style={local.chips}>
        {choices.map((choice) => {
          const selected = !open && choice.key === picked;
          return (
            <Pressable
              key={choice.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                setCustom(false);
                onChange(choice.date);
              }}
              style={[local.chip, selected && local.chipSelected]}
            >
              <Text style={[local.chipText, selected && local.chipTextOn]}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: open }}
          testID="when-custom"
          onPress={() => setCustom(true)}
          style={[local.chip, open && local.chipSelected]}
        >
          <Text style={[local.chipText, open && local.chipTextOn]}>
            Pick a date…
          </Text>
        </Pressable>
      </View>

      {open && (
        <View style={local.triple}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Year</Text>
            <TextInput
              style={styles.input}
              value={date.year}
              onChangeText={(value) => onChange({ ...date, year: value })}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Month</Text>
            <TextInput
              style={styles.input}
              value={date.month}
              onChangeText={(value) =>
                onChange({
                  ...date,
                  month: value,
                  // A day is only meaningful alongside a month.
                  ...(value === "" ? { day: "" } : {}),
                })
              }
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text
              style={[
                styles.fieldLabel,
                date.month.trim() === "" && { opacity: 0.5 },
              ]}
            >
              Day
            </Text>
            <TextInput
              style={[
                styles.input,
                date.month.trim() === "" && { opacity: 0.5 },
              ]}
              value={date.day}
              onChangeText={(value) => onChange({ ...date, day: value })}
              editable={date.month.trim() !== ""}
              keyboardType="number-pad"
            />
          </View>
        </View>
      )}

      <View style={fills.length === 0 ? undefined : local.chips}>
        {fills.map((iso) => {
          const [y, m, d] = iso.split("-");
          if (y === undefined || m === undefined || d === undefined)
            return null;
          const already =
            date.month === String(Number(m)) && date.day === String(Number(d));
          if (already) return null;
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              onPress={() =>
                onChange({
                  year: String(Number(y)),
                  month: String(Number(m)),
                  day: String(Number(d)),
                })
              }
              style={local.chip}
            >
              <Text style={local.chipText}>{monthDay(iso)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: colors.selectedBg,
    borderColor: colors.selectedBg,
  },
  chipText: {
    fontSize: 15,
    color: colors.text,
  },
  chipTextOn: {
    color: colors.selectedText,
    fontWeight: "600",
  },
  triple: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
});
