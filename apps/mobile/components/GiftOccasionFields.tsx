import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { GiftOccasion } from "@leapsake/schema";
import {
  type DateFields,
  type GiftOccasionChoice,
  datePart,
  occasionKey,
  occasionOfKey,
} from "@leapsake/ui/headless";
import { SelectField } from "./SelectField";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * The occasion + partial-date pair, ported from the desktop `GiftOccasionFields`.
 * Authored together because their *meanings* come from the pair:
 * "Christmas, no year" is a standing intent, "Christmas 2026" is one specific one,
 * a bare date is an arbitrary deadline, and neither is "someday". Serves a
 * suggestion's **target** date and a giving's **what-happened** date alike.
 *
 * The occasion picker is a {@link SelectField} (desktop's `<select>`): the pool is
 * a short, fully-known list — this recipient's own milestones plus the holidays
 * they observe — not the long unfamiliar list a `Typeahead` exists for.
 *
 * The occasion is only a **label**: the date stays the source of truth for *when*,
 * so picking a holiday never writes a date on its own. It does offer one —
 * `holidays.occurrencesIn` resolves "Christmas" + 1941 to Dec 25, surfaced as a
 * button the user presses. A lunisolar holiday can fall **twice** in one Gregorian
 * year, so every occurrence is offered and none is assumed.
 */
export function GiftOccasionFields({
  label,
  occasions,
  occasion,
  onOccasionChange,
  date,
  onDateChange,
}: {
  label: string;
  occasions: readonly GiftOccasionChoice[];
  occasion: GiftOccasion | null;
  onOccasionChange: (occasion: GiftOccasion | null) => void;
  date: DateFields;
  onDateChange: (date: DateFields) => void;
}) {
  const core = useCore();
  const [fills, setFills] = useState<string[]>([]);

  const year = datePart(date.year);
  const holidayId = occasion?.type === "holiday" ? occasion.id : null;

  // Offer the occasion's real date(s) once there's a holiday and a year to
  // resolve them in. Re-runs when either moves; a stale response is dropped.
  useEffect(() => {
    if (holidayId === null || year === null) {
      setFills([]);
      return;
    }
    let active = true;
    void core.holidays
      .occurrencesIn(holidayId, year)
      .then((dates) => active && setFills(dates));
    return () => {
      active = false;
    };
  }, [core, holidayId, year]);

  // One flat option list with a leading unset — RN's picker has no optgroup, so
  // the two kinds are distinguished by a suffix rather than by grouping.
  const options = [
    { value: "", label: "— none —" },
    ...occasions.map((o) => ({
      value: occasionKey(o),
      label: o.type === "holiday" ? `${o.label} (holiday)` : o.label,
    })),
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <SelectField
        label="Occasion"
        value={occasionKey(occasion)}
        options={options}
        onChange={(value) => onOccasionChange(occasionOfKey(value))}
      />

      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Year</Text>
          <TextInput
            style={styles.input}
            value={date.year}
            onChangeText={(value) => onDateChange({ ...date, year: value })}
            keyboardType="number-pad"
          />
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Month</Text>
          <TextInput
            style={styles.input}
            value={date.month}
            onChangeText={(value) =>
              onDateChange({
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
            style={[styles.input, date.month.trim() === "" && { opacity: 0.5 }]}
            value={date.day}
            onChangeText={(value) => onDateChange({ ...date, day: value })}
            editable={date.month.trim() !== ""}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {fills.map((iso) => {
        const [y, m, d] = iso.split("-");
        if (y === undefined || m === undefined || d === undefined) return null;
        const already =
          date.month === String(Number(m)) && date.day === String(Number(d));
        if (already) return null;
        return (
          <Pressable
            key={iso}
            accessibilityRole="button"
            onPress={() =>
              onDateChange({
                year: String(Number(y)),
                month: String(Number(m)),
                day: String(Number(d)),
              })
            }
          >
            <Text style={styles.link}>Use {iso}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
