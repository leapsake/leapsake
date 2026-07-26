import type { GiftOccasion } from "@leapsake/schema";
import { useEffect, useId, useState } from "react";
import {
  type GiftOccasionChoice,
  type PartialDate,
  useGiftsPorts,
} from "./ports.js";

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
export function parseDateFields(d: DateFields): PartialDate | null {
  const year = num(d.year);
  const month = num(d.month);
  const day = month !== null ? num(d.day) : null;
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** A stored partial date back into typed fields (for an edit form's initial state). */
export function dateFieldsOf(d: PartialDate): DateFields {
  return {
    year: d.year?.toString() ?? "",
    month: d.month?.toString() ?? "",
    day: d.day?.toString() ?? "",
  };
}

const keyOf = (o: GiftOccasion | null) =>
  o === null ? "" : `${o.type}:${o.id}`;

/**
 * The occasion + partial-date pair, authored together because their *meanings*
 * come from the pair: “Christmas, no year” is a standing intent,
 * “Christmas 2026” is one specific one, a bare date is an arbitrary deadline, and
 * neither is “someday”. Used for a suggestion's **target** date and for a giving's
 * **what-happened** date — the same two controls, different columns underneath.
 *
 * The occasion is only a **label**: the date stays the source of truth for *when*,
 * which is why picking a holiday never writes a date on its own. It does offer
 * one — `loadOccurrences` resolves “Christmas” + 1941 to Dec 25, surfaced as a
 * button the user presses. A lunisolar holiday can fall **twice** in one Gregorian
 * year, so every occurrence is offered and none is assumed.
 */
export function GiftOccasionFields({
  legend,
  occasions,
  occasion,
  onOccasionChange,
  date,
  onDateChange,
}: {
  legend: string;
  occasions: readonly GiftOccasionChoice[];
  occasion: GiftOccasion | null;
  onOccasionChange: (occasion: GiftOccasion | null) => void;
  date: DateFields;
  onDateChange: (date: DateFields) => void;
}) {
  const { loadOccurrences } = useGiftsPorts();
  const id = useId();
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
    void loadOccurrences(holidayId, year).then(
      (dates) => active && setFills(dates),
    );
    return () => {
      active = false;
    };
  }, [holidayId, year, loadOccurrences]);

  const milestones = occasions.filter((o) => o.type === "milestone");
  const holidays = occasions.filter((o) => o.type === "holiday");

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
    <fieldset>
      <legend>{legend}</legend>
      <p>
        <label htmlFor={`${id}-occasion`}>Occasion</label>{" "}
        <select
          id={`${id}-occasion`}
          value={keyOf(occasion)}
          onChange={(e) => pickOccasion(e.target.value)}
        >
          <option value="">— none —</option>
          {milestones.length > 0 && (
            <optgroup label="Milestones">
              {milestones.map((o) => (
                <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {holidays.length > 0 && (
            <optgroup label="Holidays">
              {holidays.map((o) => (
                <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </p>
      <p>
        <input
          type="number"
          min="1"
          placeholder="Year"
          value={date.year}
          aria-label="Year"
          onChange={(e) => onDateChange({ ...date, year: e.target.value })}
        />{" "}
        <input
          type="number"
          min="1"
          max="12"
          placeholder="Month"
          value={date.month}
          aria-label="Month"
          onChange={(e) =>
            onDateChange({
              ...date,
              month: e.target.value,
              // A day is only meaningful alongside a month.
              ...(e.target.value === "" ? { day: "" } : {}),
            })
          }
        />{" "}
        <input
          type="number"
          min="1"
          max="31"
          placeholder="Day"
          value={date.day}
          aria-label="Day"
          disabled={date.month.trim() === ""}
          onChange={(e) => onDateChange({ ...date, day: e.target.value })}
        />
      </p>
      {fills.map((iso) => {
        const [y, m, d] = iso.split("-");
        const already =
          date.month === String(Number(m)) && date.day === String(Number(d));
        if (already || y === undefined || m === undefined || d === undefined) {
          return null;
        }
        return (
          <p key={iso}>
            <button
              type="button"
              onClick={() =>
                onDateChange({
                  year: String(Number(y)),
                  month: String(Number(m)),
                  day: String(Number(d)),
                })
              }
            >
              Use {iso}
            </button>
          </p>
        );
      })}
    </fieldset>
  );
}
