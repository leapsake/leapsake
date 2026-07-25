import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { GiftOccasionOption } from "@leapsake/core";
import type { GiftOccasion } from "@leapsake/schema";
import { SelectField } from "./SelectField";
import { useCore } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/** A partial date as typed — strings so an empty input stays empty, not 0/NaN. */
export interface DateFields {
  year: string;
  month: string;
  day: string;
}

export const emptyDate = (): DateFields => ({ year: "", month: "", day: "" });

/** A typed date part as a positive integer, or null when blank/unparseable. */
function num(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The typed fields as a partial date, or null when wholly blank. A lone day (no
 * month) drops the day — the schema's day⇒month rule, mirrored here so the form
 * only submits values the schema will accept.
 */
export function parseDateFields(
  d: DateFields,
): { year: number | null; month: number | null; day: number | null } | null {
  const year = num(d.year);
  const month = num(d.month);
  const day = month !== null ? num(d.day) : null;
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** A stored partial date back into typed fields (for an edit form's initial state). */
export function dateFieldsOf(d: {
  year: number | null;
  month: number | null;
  day: number | null;
}): DateFields {
  return {
    year: d.year?.toString() ?? "",
    month: d.month?.toString() ?? "",
    day: d.day?.toString() ?? "",
  };
}

const keyOf = (o: GiftOccasion | null) =>
  o === null ? "" : `${o.type}:${o.id}`;

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
  occasions: GiftOccasionOption[];
  occasion: GiftOccasion | null;
  onOccasionChange: (occasion: GiftOccasion | null) => void;
  date: DateFields;
  onDateChange: (date: DateFields) => void;
}) {
  const core = useCore();
  const [fills, setFills] = useState<string[]>([]);

  const year = num(date.year);
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
      value: `${o.type}:${o.id}`,
      label: o.type === "holiday" ? `${o.label} (holiday)` : o.label,
    })),
  ];

  function pickOccasion(value: string) {
    if (value === "") {
      onOccasionChange(null);
      return;
    }
    const [type, ...rest] = value.split(":");
    onOccasionChange({
      type: type as GiftOccasion["type"],
      id: rest.join(":"),
    });
  }

  return (
    <View style={styles.section}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <SelectField
        label="Occasion"
        value={keyOf(occasion)}
        options={options}
        onChange={pickOccasion}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={date.year}
          onChangeText={(value) => onDateChange({ ...date, year: value })}
          keyboardType="number-pad"
          placeholder="Year"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Year"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
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
          placeholder="Month"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Month"
        />
        <TextInput
          style={[
            styles.input,
            { flex: 1 },
            date.month.trim() === "" && { opacity: 0.5 },
          ]}
          value={date.day}
          onChangeText={(value) => onDateChange({ ...date, day: value })}
          editable={date.month.trim() !== ""}
          keyboardType="number-pad"
          placeholder="Day"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Day"
        />
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
