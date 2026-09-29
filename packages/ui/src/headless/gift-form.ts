// The gift forms' logic, without their markup, shared by web and mobile.
import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import type { Shaped } from "./forms/use-draft-form.js";
import type { GiftCaptureInput, PartyOption } from "./gifts-ports.js";

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

/** One recipient as a capture-payload entry, from the bare party. */
export function captureRecipientOf(
  party: { type: GiftPartyType; id: string },
  given: boolean,
): { party: { type: GiftPartyType; id: string }; given: boolean } {
  return { party: { type: party.type, id: party.id }, given };
}

/** The pool's idea with this exact title, ignoring case, or a new one. The
 *  only dedup a capture gets: `core.gifts.capture` mints on every title. */
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

/** A capture as the form holds it; `given` is the fixed recipient's tick. */
export interface GiftCaptureDraft {
  title: string;
  url: string;
  given: boolean;
  recipients: RecipientEntry[];
}

export const giftCaptureDraftOf = (startGiven = false): GiftCaptureDraft => ({
  title: "",
  url: "",
  given: startGiven,
  recipients: [],
});

/** The capture to write, pointing at a matching idea when one exists. */
export function giftCaptureInputOf(
  draft: GiftCaptureDraft,
  ideaPool: readonly Pick<GiftIdea, "id" | "title">[],
  fixedRecipient?: PartyOption,
): Shaped<{ input: GiftCaptureInput }, { title?: "required" }> {
  if (draft.title.trim() === "") {
    return { ok: false, errors: { title: "required" } };
  }
  const recipients = fixedRecipient
    ? [captureRecipientOf(fixedRecipient, draft.given)]
    : draft.recipients.map((r) => captureRecipientOf(r.option, r.given));
  return {
    ok: true,
    input: { giftIdea: giftIdeaOf(draft, ideaPool), recipients },
  };
}
