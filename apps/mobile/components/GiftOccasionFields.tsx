import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { GiftOccasion } from "@leapsake/schema";
import {
  type DateFields,
  type GiftAdornmentKind,
  type GiftOccasionChoice,
  datePart,
  occasionKey,
  occasionOfKey,
} from "@leapsake/ui/headless";
import { SelectField } from "./SelectField";
import { WhenField } from "./WhenField";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** What the occasion picker calls itself, in each of the two tenses. */
const OCCASION_LABEL: Record<GiftAdornmentKind, string> = {
  suggestion: "For which occasion?",
  giving: "What was the occasion?",
};

/**
 * The occasion + date pair, ported from the desktop `GiftOccasionFields`.
 * Authored together because their *meanings* come from the pair: "Christmas, no
 * year" is a standing intent, "Christmas 2026" is one specific one, a bare date
 * is an arbitrary deadline, and neither is "someday". Serves a suggestion's
 * **target** date and a giving's **what-happened** date alike — which is what
 * `kind` names, and it is the field's whole tense: the picker's label above, and
 * which years {@link WhenField} offers below.
 *
 * The occasion picker is a {@link SelectField} (desktop's `<select>`): the pool is
 * a short, fully-known list — not the long unfamiliar list a `Typeahead` exists
 * for. Core hands it over already **ranked** (what is true of this recipient,
 * then the usual gift occasions, then everything else) and already labelled, so
 * this renders the list in the order it arrives and adds no policy of its own.
 *
 * The occasion is only a **label**: the date stays the source of truth for *when*,
 * so picking a holiday never writes a date on its own. It does offer one —
 * `holidays.occurrencesIn` resolves "Christmas" + 1941 to Dec 25, handed to
 * `WhenField` as further taps. A lunisolar holiday can fall **twice** in one
 * Gregorian year, so every occurrence is offered and none is assumed.
 */
export function GiftOccasionFields({
  kind,
  label = OCCASION_LABEL[kind],
  occasions,
  occasion,
  onOccasionChange,
  date,
  onDateChange,
}: {
  kind: GiftAdornmentKind;
  /** Overridden where the surrounding form has already set the tense in words. */
  label?: string;
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
  // the kinds are distinguished by a suffix rather than by grouping, and the
  // ranking core supplied (`tier`) survives as plain list order.
  //
  // A choice that doesn't exist yet is prefixed "＋": picking it writes something
  // — the holiday observance, or a dateless milestone — and that is explained
  // once, under the field, rather than guessed at from a dropdown row.
  const options = [
    { value: "", label: "— none —" },
    ...occasions.map((o) => ({
      value: occasionKey(o),
      label: `${o.existing === false ? "＋ " : ""}${
        o.type === "holiday" ? `${o.label} (holiday)` : o.label
      }`,
    })),
  ];

  // Only worth explaining when the picked one actually creates something.
  const picked = occasions.find(
    (o) => occasionKey(o) === occasionKey(occasion),
  );
  const willCreate = picked?.existing === false;

  return (
    <View style={styles.section}>
      {/*
        Not unique on the screen: a gift can carry several giving rows, each with
        its own occasion, so a driver addresses one by `id` *plus* index. Which is
        still far better than by position — see the note in `PersonFields`.
      */}
      <SelectField
        testID="gift-occasion"
        label={label}
        value={occasionKey(occasion)}
        options={options}
        onChange={(value) => onOccasionChange(occasionOfKey(value))}
      />

      {willCreate && (
        <Text style={styles.muted}>
          {picked?.type === "holiday"
            ? `Saving also records that they observe ${picked.label}.`
            : `Saving also adds ${picked?.label.toLowerCase()} to their record — no date needed, you can fill it in later.`}
        </Text>
      )}

      <WhenField
        kind={kind}
        date={date}
        onChange={onDateChange}
        fills={fills}
      />
    </View>
  );
}
