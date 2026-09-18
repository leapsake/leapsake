// Classifies a pair of people as likely duplicates. It only proposes: every
// merge still goes through the user.

/** The fields compared for one person, already folded and normalized. */
export interface DuplicateInput {
  /** Display name (e.g. "Jane Wainwright"), used only to render reason text. */
  name: string;
  /** `fold(first + " " + last)`, the match key; empty never matches. */
  foldedName: string;
  /** Normalized emails (`normalizeEmail`), the strong exact-match keys. */
  emails: string[];
  /** Normalized phones (`normalizePhone`), the strong exact-match keys. */
  phones: string[];
  /**
   * Social handles with their platform, since a handle is unique only within
   * one: `@jane` on two platforms is often two people.
   */
  handles: { platform: string; handle: string }[];
}

/** How confident a pair is a duplicate. `"low"` is reserved and unused. */
export type DuplicateTier = "high" | "medium" | "low" | "none";

/** Sort weight per tier, high first. The detector orders candidates by this. */
export const TIER_RANK: Record<DuplicateTier, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

/** The verdict on a pair: a tier plus the human-readable "why". */
export interface DuplicateScore {
  tier: DuplicateTier;
  reasons: string[];
}

/** A handle's match key, NUL-joined so no platform or handle can forge one. */
function handleKey(h: { platform: string; handle: string }): string {
  return `${h.platform}\u0000${h.handle}`;
}

/** One reason per email, phone, or handle the two people share. */
function sharedContacts(a: DuplicateInput, b: DuplicateInput): string[] {
  const reasons: string[] = [];
  const bEmails = new Set(b.emails);
  for (const email of new Set(a.emails)) {
    if (bEmails.has(email)) reasons.push(`Shared email ${email}`);
  }
  const bPhones = new Set(b.phones);
  for (const phone of new Set(a.phones)) {
    if (bPhones.has(phone)) reasons.push(`Shared phone ${phone}`);
  }
  const bHandles = new Set(b.handles.map(handleKey));
  const seen = new Set<string>();
  for (const handle of a.handles) {
    const k = handleKey(handle);
    if (seen.has(k) || !bHandles.has(k)) continue;
    seen.add(k);
    reasons.push(`Shared ${handle.platform} handle ${handle.handle}`);
  }
  return reasons;
}

/** Whether the two share a non-empty folded name. */
function sameFoldedName(a: DuplicateInput, b: DuplicateInput): boolean {
  return a.foldedName !== "" && a.foldedName === b.foldedName;
}

/**
 * Score a pair: `high` for a shared contact and name, `medium` for either one
 * alone, else `none`.
 */
export function scoreDuplicate(
  a: DuplicateInput,
  b: DuplicateInput,
): DuplicateScore {
  const contactReasons = sharedContacts(a, b);
  const nameMatch = sameFoldedName(a, b);

  const reasons: string[] = [...contactReasons];
  if (nameMatch) reasons.push(`Same name "${a.name}"`);

  const hasSharedContact = contactReasons.length > 0;
  let tier: DuplicateTier = "none";
  if (hasSharedContact && nameMatch) tier = "high";
  else if (hasSharedContact || nameMatch) tier = "medium";

  return { tier, reasons };
}
