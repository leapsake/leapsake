/**
 * The "when?" shortcuts a gift's date field offers, without their markup.
 *
 * A gift's date used to be three number inputs (year, month, day), always
 * visible, in every one of the four places a gift can name an occasion. But the
 * answer is almost never an arbitrary date: it is *the* occasion, in one of two
 * or three plausible years. So the years become taps and the triple moves behind
 * a disclosure — which is a rule about what people mean, not about markup, so it
 * lives here where both renderers can read it.
 *
 * Which years are plausible depends on which way the field points in time: a
 * suggestion is a *target* and looks forward, a giving is a fact and looks back.
 */
import type { CivilDate } from "@leapsake/schema";
import { type DateFields, emptyDate } from "./partial-date.js";

/**
 * Which of the two dated things a field is editing. The pair is the whole gift
 * vocabulary — a suggestion is idea × recipient with a target date, a giving is
 * a dated fact — and it decides the field's tense throughout: its labels, and
 * which years {@link whenChoices} offers.
 */
export type GiftAdornmentKind = "suggestion" | "giving";

/** One shortcut in the "When?" row: what it says, and the date it sets. */
export interface WhenChoice {
  /** Stable identity for a React key and for {@link whenKeyOf}'s answer. */
  key: string;
  label: string;
  date: DateFields;
}

/** The key of the "no date at all" choice, which every kind offers first. */
export const UNDATED_KEY = "none";

/** A bare year as a choice — the shape both tenses are mostly made of. */
const year = (n: number): WhenChoice => ({
  key: String(n),
  label: String(n),
  date: { year: String(n), month: "", day: "" },
});

/**
 * The shortcuts to offer, most likely first after the unset.
 *
 * A **suggestion** looks forward: no target at all (the default — "someday"),
 * this year, or next. A **giving** looks back: today (by far the commonest
 * answer, since you log a gift just after giving it), this year, or last. Both
 * keep an undated choice, because an occasion alone is a real answer —
 * "at some Christmas" is a thing people mean and the schema stores.
 *
 * A year-only choice sets *just* the year: the month and day are the occasion's
 * to supply, and for a holiday the field offers them separately once the year
 * is known (a lunisolar holiday can fall twice in one Gregorian year, so they
 * are never assumed).
 */
export function whenChoices(
  kind: GiftAdornmentKind,
  today: CivilDate,
): WhenChoice[] {
  if (kind === "suggestion") {
    return [
      { key: UNDATED_KEY, label: "Someday", date: emptyDate() },
      year(today.year),
      year(today.year + 1),
    ];
  }

  return [
    { key: UNDATED_KEY, label: "No date", date: emptyDate() },
    {
      key: "today",
      label: "Today",
      date: {
        year: String(today.year),
        month: String(today.month),
        day: String(today.day),
      },
    },
    year(today.year),
    year(today.year - 1),
  ];
}

/** Whether two typed dates say the same thing, whitespace aside. */
const sameDate = (a: DateFields, b: DateFields) =>
  a.year.trim() === b.year.trim() &&
  a.month.trim() === b.month.trim() &&
  a.day.trim() === b.day.trim();

/**
 * Which shortcut the current date corresponds to, or `null` when it is one the
 * row cannot say — a past target, a specific day, a stored date being edited.
 * That `null` is what opens the year/month/day disclosure, so a date the
 * shortcuts can't express is never hidden behind them.
 *
 * "Today" is checked before the bare year it shares, so logging a gift today
 * lights the chip that says so rather than the one that says only the year.
 */
export function whenKeyOf(
  date: DateFields,
  choices: readonly WhenChoice[],
): string | null {
  return choices.find((choice) => sameDate(choice.date, date))?.key ?? null;
}
