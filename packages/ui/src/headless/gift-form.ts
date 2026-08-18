/**
 * The gift forms' logic, without their markup.
 *
 * The web forms and the React Native ones are honest ports of each other — the
 * markup differs because the platforms do — but what a recipient *is* while it's
 * being authored, when a giving row counts as blank, how a party's occasions and
 * prior gifts are fetched, and how a party or an occasion is keyed are domain
 * rules, identical in both. They were two hand-kept copies, and only the web one
 * was under test.
 */
import type {
  CaptureRecipient,
  GiftGivingEntry,
  GiftOccasion,
  GiftPartyType,
} from "@leapsake/schema";
import { useEffect, useRef, useState } from "react";
import type {
  GiftOccasionChoice,
  GiftsPorts,
  GivenRow,
  PartyOption,
} from "./gifts-ports.js";
import { type DateFields, emptyDate, parseDateFields } from "./partial-date.js";

/** A person or pet as one string — a React key, a Set member, a route param. */
export const partyKey = (party: { type: string; id: string }) =>
  `${party.type}:${party.id}`;

/** An occasion as an option's value. The empty string is “no occasion”, which is
 *  a pickable choice rather than an absence of one. */
export const occasionKey = (occasion: GiftOccasion | null) =>
  occasion === null ? "" : `${occasion.type}:${occasion.id}`;

/** A picked option's value back into an occasion, the inverse of
 *  {@link occasionKey}. */
export function occasionOfKey(value: string): GiftOccasion | null {
  if (value === "") return null;
  const [type, ...rest] = value.split(":");
  return { type: type as GiftOccasion["type"], id: rest.join(":") };
}

/** One giving being authored: a what-happened date and an optional occasion.
 *  `id` is a stable React key across adds/removes. */
export interface GivingRow {
  id: string;
  date: DateFields;
  occasion: GiftOccasion | null;
}

/** What the “For…” disclosure holds for a recipient that ends up a *suggestion*
 *  (no dates) — its target date and occasion. */
export interface SuggestionFields {
  date: DateFields;
  occasion: GiftOccasion | null;
}

/** A recipient in the form, with *its own* givings (a date under Alice is a gift
 *  to Alice, not to everyone) and its own suggestion fields. */
export interface RecipientEntry {
  option: PartyOption;
  givings: GivingRow[];
  suggestion: SuggestionFields;
}

export const newGivingRow = (): GivingRow => ({
  id: crypto.randomUUID(),
  date: emptyDate(),
  occasion: null,
});

export const newSuggestionFields = (): SuggestionFields => ({
  date: emptyDate(),
  occasion: null,
});

/** The giving rows as capture givings — a row with neither a date nor an occasion
 *  is blank and drops out. */
export function givingsOf(rows: readonly GivingRow[]): GiftGivingEntry[] {
  return rows
    .map((row) => ({ date: parseDateFields(row.date), occasion: row.occasion }))
    .filter((g) => g.date !== null || g.occasion !== null)
    .map((g) => ({
      ...(g.date === null ? {} : { date: g.date }),
      occasion: g.occasion,
    }));
}

/**
 * Rewrite a **staged** occasion onto real ids — what a create form needs, where
 * the gift is authored before its recipient (and so before that recipient's
 * milestones) exists.
 *
 * A holiday pointer is already real: holidays come from a catalog that predates
 * the form, so it passes through untouched. A milestone pointer holds the
 * client-minted key the create form staged it under, and is looked up in the map
 * the caller builds as it writes those milestones.
 *
 * An unresolvable milestone key means that milestone never landed, so the
 * occasion is **dropped** rather than written dangling: `gifts.capture` does not
 * validate occasion ids, so a bad pointer would be stored as-is.
 */
export function resolveStagedOccasion(
  occasion: GiftOccasion | null,
  milestoneIds: ReadonlyMap<string, string>,
): GiftOccasion | null {
  if (occasion === null || occasion.type !== "milestone") return occasion;
  const id = milestoneIds.get(occasion.id);
  return id === undefined ? null : { type: "milestone", id };
}

/** One recipient as a capture-payload entry, carrying both arms; core reads the
 *  givings when there are any and the suggestion fields otherwise.
 *
 *  Takes the bare party rather than a {@link PartyOption} — it reads only `type`
 *  and `id`, and a create form has no label to hand it. */
export function captureRecipientOf(
  party: { type: GiftPartyType; id: string },
  givings: readonly GivingRow[],
  suggestion: SuggestionFields,
): CaptureRecipient {
  return {
    party: { type: party.type, id: party.id },
    givings: givingsOf(givings),
    suggestion: {
      occasion: suggestion.occasion,
      targetDate: parseDateFields(suggestion.date),
    },
  };
}

/** Replace one recipient's fields, addressed by {@link partyKey}. */
export function patchRecipient(
  entries: readonly RecipientEntry[],
  key: string,
  patch: Partial<RecipientEntry>,
): RecipientEntry[] {
  return entries.map((entry) =>
    partyKey(entry.option) === key ? { ...entry, ...patch } : entry,
  );
}

/** Drop one recipient, addressed by {@link partyKey}. */
export function removeRecipient(
  entries: readonly RecipientEntry[],
  key: string,
): RecipientEntry[] {
  return entries.filter((entry) => partyKey(entry.option) !== key);
}

/**
 * The reads {@link usePartyContext} makes — the slice of {@link GiftsPorts} it
 * needs, so a host that has no reason to implement the writes doesn't have to.
 *
 * **The functions must keep a stable identity across renders** (a module-scope
 * object, or a `useMemo`): they are effect dependencies, and a fresh object per
 * render would re-fetch every party's context on every keystroke.
 */
export type PartyLoaders = Pick<GiftsPorts, "loadOccasions" | "loadGiven">;

/** What the form knows about one party: the occasions it can name, and what it
 *  has already been given (the re-gift guard's source). */
interface PartyContext {
  occasions: GiftOccasionChoice[];
  given: GivenRow[];
}

const EMPTY_CONTEXT: PartyContext = { occasions: [], given: [] };

/** Each party's context, looked up by party rather than by key. */
export interface PartyContexts {
  occasionsFor(party: PartyOption): readonly GiftOccasionChoice[];
  /**
   * What this party has already been given of one idea — the re-gift guard. A
   * brand-new title (`undefined`) can't have been given before, so it reads
   * empty without a fetch.
   */
  alreadyGiven(
    party: PartyOption,
    giftIdeaId: string | undefined,
  ): readonly GivenRow[];
}

/**
 * Each party's context, fetched once per party and kept for the life of the form.
 * An unfetched party reads as empty, so the pickers render (empty) rather than
 * flicker in.
 */
export function usePartyContext(
  parties: readonly PartyOption[],
  loaders: PartyLoaders,
): PartyContexts {
  const { loadOccasions, loadGiven } = loaders;
  const [pools, setPools] = useState<Map<string, PartyContext>>(new Map());
  // Which parties have been asked for, in a ref rather than in `pools`: the
  // effect must not re-run each time a fetch lands, or picking one recipient
  // would re-ask for every earlier one.
  const asked = useRef(new Set<string>());
  const wanted = parties.map(partyKey).join(",");

  useEffect(() => {
    let active = true;
    for (const key of wanted === "" ? [] : wanted.split(",")) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const [type, ...rest] = key.split(":");
      const party = {
        type: type as PartyOption["type"],
        id: rest.join(":"),
      };
      void Promise.all([loadOccasions(party), loadGiven(party)]).then(
        ([occasions, given]) => {
          if (active) {
            setPools((prev) => new Map(prev).set(key, { occasions, given }));
          }
        },
      );
    }
    return () => {
      active = false;
    };
  }, [wanted, loadOccasions, loadGiven]);

  const contextOf = (party: PartyOption) =>
    pools.get(partyKey(party)) ?? EMPTY_CONTEXT;

  return {
    occasionsFor: (party) => contextOf(party).occasions,
    alreadyGiven: (party, giftIdeaId) =>
      giftIdeaId === undefined
        ? []
        : contextOf(party).given.filter((g) => g.giftIdeaId === giftIdeaId),
  };
}
