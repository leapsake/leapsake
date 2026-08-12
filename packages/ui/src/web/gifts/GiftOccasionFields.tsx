import type { GiftOccasion } from "@leapsake/schema";
import { useEffect, useId, useState } from "react";
import {
  type DateFields,
  type GiftOccasionChoice,
  datePart,
  useGiftsPorts,
} from "../../headless/index.js";
import { useMessages } from "../../messages/index.js";

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
  const m = useMessages();
  const id = useId();
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
        <label htmlFor={`${id}-occasion`}>{m.giftOccasion.occasionLabel}</label>{" "}
        <select
          id={`${id}-occasion`}
          value={keyOf(occasion)}
          onChange={(e) => pickOccasion(e.target.value)}
        >
          <option value="">{m.giftOccasion.noOccasion}</option>
          {milestones.length > 0 && (
            <optgroup label={m.giftOccasion.milestoneGroup}>
              {milestones.map((o) => (
                <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {holidays.length > 0 && (
            <optgroup label={m.giftOccasion.holidayGroup}>
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
          placeholder={m.giftOccasion.year}
          value={date.year}
          aria-label={m.giftOccasion.year}
          onChange={(e) => onDateChange({ ...date, year: e.target.value })}
        />{" "}
        <input
          type="number"
          min="1"
          max="12"
          placeholder={m.giftOccasion.month}
          value={date.month}
          aria-label={m.giftOccasion.month}
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
          placeholder={m.giftOccasion.day}
          value={date.day}
          aria-label={m.giftOccasion.day}
          disabled={date.month.trim() === ""}
          onChange={(e) => onDateChange({ ...date, day: e.target.value })}
        />
      </p>
      {fills.map((iso) => {
        const [fillYear, fillMonth, fillDay] = iso.split("-");
        const already =
          date.month === String(Number(fillMonth)) &&
          date.day === String(Number(fillDay));
        if (
          already ||
          fillYear === undefined ||
          fillMonth === undefined ||
          fillDay === undefined
        ) {
          return null;
        }
        return (
          <p key={iso}>
            <button
              type="button"
              onClick={() =>
                onDateChange({
                  year: String(Number(fillYear)),
                  month: String(Number(fillMonth)),
                  day: String(Number(fillDay)),
                })
              }
            >
              {m.giftOccasion.useDate(iso)}
            </button>
          </p>
        );
      })}
    </fieldset>
  );
}
