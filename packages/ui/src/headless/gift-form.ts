/**
 * The gift forms' logic, without their markup.
 *
 * The web forms and the React Native ones are honest ports of each other — the
 * markup differs because the platforms do — but what a recipient *is* while it's
 * being authored, and how a party is keyed, are domain rules identical in both.
 * They were two hand-kept copies, and only the web one was under test.
 *
 * This module used to be four times this size, holding a giving row, a
 * suggestion's target fields, an idea's own occasions, a staged-occasion
 * resolver, and a per-party context that fetched each party's occasion pool and
 * prior gifts. All of it existed to serve occasions and dates, which are out of
 * v0.1 scope; a recipient is now a party and a checkbox.
 */
import type { GiftPartyType } from "@leapsake/schema";
import type { PartyOption } from "./gifts-ports.js";

/** A person or pet as one string — a React key, a Set member, a route param. */
export const partyKey = (party: { type: string; id: string }) =>
  `${party.type}:${party.id}`;

/** A recipient in the form: who it is, and whether they have had it yet. */
export interface RecipientEntry {
  option: PartyOption;
  given: boolean;
}

export const newRecipientEntry = (option: PartyOption): RecipientEntry => ({
  option,
  given: false,
});

/** One recipient as a capture-payload entry. Takes the bare party rather than a
 *  {@link PartyOption} — the payload has no use for a label. */
export function captureRecipientOf(
  party: { type: GiftPartyType; id: string },
  given: boolean,
): { party: { type: GiftPartyType; id: string }; given: boolean } {
  return { party: { type: party.type, id: party.id }, given };
}

/**
 * The idea a capture should point at: the one already in the pool whose title
 * matches exactly (case-insensitively), or a brand-new one. Near-duplicate
 * *different* titles are still allowed — tolerated by design, and the
 * reconciliation pass is where that is dealt with.
 *
 * `core.gifts.capture` does no such matching of its own — handed a title it mints
 * an idea — so this is the only thing standing between "Socks" typed twice and
 * two Socks. It lives here because both writers need it and they are nowhere near
 * each other: the capture screen, which has the pool on hand, and the entity
 * form's save, which lists it at write time.
 */
export function giftIdeaOf(
  draft: { title: string; url: string },
  pool: readonly { id: string; title: string }[],
): { id: string } | { title: string; url?: string } {
  const title = draft.title.trim();
  const found = pool.find((i) => i.title.toLowerCase() === title.toLowerCase());
  if (found !== undefined) return { id: found.id };
  const url = draft.url.trim();
  return { title, ...(url === "" ? {} : { url }) };
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
