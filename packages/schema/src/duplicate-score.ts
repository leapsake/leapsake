/**
 * Pairwise duplicate scoring for people — the *detection* half of reconciliation
 * (packages/core/README.md). Pure and dependency-free like
 * {@link ./merge.ts}: the data layer feeds it folded/normalized fields, and it
 * returns a tier + human-readable reasons. It never touches the DB, never
 * merges, and never auto-acts — every proposed merge still goes through
 * `core.people.merge` behind a user confirm (Increment A).
 *
 * **v1 is exact-match, by design.** Matching is exact set-intersection on
 * normalized email/phone plus equality on the folded name — no string-distance
 * dependency. We *expect* to make this smarter later (a fuzzy/typo-tolerant
 * "low" tier via `fastest-levenshtein` or `cmpstr`, or a hand-rolled pattern);
 * the module is shaped so that lands additively (see {@link sameFoldedName} and
 * "Extensibility" below) without changing this module's public contract or any
 * caller.
 *
 * ## Extensibility contract (do not break)
 * - The public surface is {@link scoreDuplicate}`(a, b) -> { tier, reasons }`.
 *   The detector, `CoreApi`, IPC, and UI bind to `tier`/`reasons` only. A future
 *   numeric score must be added as an *optional* field, never a breaking change.
 * - {@link DuplicateTier} is a closed union with `"low"` reserved; turning on a
 *   fuzzy tier is a new branch in {@link scoreDuplicate}, not a contract change.
 *   The UI renders tiers data-drivenly so a new tier needs no UI rewrite.
 * - Comparisons are factored into the named predicates {@link sharedContacts}
 *   and {@link sameFoldedName}, each returning its own reasons. The fuzzy upgrade
 *   swaps the *body* of `sameFoldedName` (exact equality → distance-based) and
 *   nothing else moves.
 */

/** The fields the scorer compares for one person; the caller folds/normalizes. */
export interface DuplicateInput {
  /** Display name (e.g. "Jane Wainwright"), used only to render reason text. */
  name: string;
  /** Folded name — `fold(first + " " + last)`. The match key; empty never matches. */
  foldedName: string;
  /** Normalized emails (`normalizeEmail`), the strong exact-match keys. */
  emails: string[];
  /** Normalized phones (`normalizePhone`), the strong exact-match keys. */
  phones: string[];
  /**
   * Social profiles as `(platform, normalized handle)` pairs.
   *
   * Both halves matter, which is why this is not a bare string list like the two
   * above. A handle is only unique *within* a platform — `@jane` on Instagram and
   * `@jane` on TikTok are routinely different people, and matching on the handle
   * alone would pair strangers who happened to pick the same common name. Matched
   * as a pair, a shared handle is as strong a signal as a shared email.
   */
  handles: { platform: string; handle: string }[];
}

/**
 * How confident the pair is a duplicate. `"low"` is **reserved** for the future
 * fuzzy tier (it never fires in v1) — kept in the union so the eventual upgrade
 * is additive. Ordered high → none for sorting in the detector.
 */
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

/**
 * Exact normalized email/phone the two people share — the strongest signal. A
 * shared exact contact is rare for distinct real people, so it carries a pair
 * even without a name match. Returns one reason per shared value.
 */
/** A handle's match key. NUL-joined so no platform or handle can forge a pair. */
function handleKey(h: { platform: string; handle: string }): string {
  return `${h.platform}\u0000${h.handle}`;
}

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

/**
 * Whether the two people share a name. **v1: exact equality on the folded name**
 * (case/accent-insensitive via the caller's `fold`); an empty folded name never
 * matches, so two people with no name are not paired.
 *
 * This is the single seam for smarter matching: the future fuzzy/typo-tolerant
 * tier (e.g. "Jon" ≈ "John") replaces this body with a distance-based check
 * (`fastest-levenshtein` or `cmpstr`), returning a `low`-grade reason, and the
 * tier assembly in {@link scoreDuplicate} stays as-is. Keep the signature.
 */
function sameFoldedName(a: DuplicateInput, b: DuplicateInput): boolean {
  return a.foldedName !== "" && a.foldedName === b.foldedName;
}

/**
 * Score one candidate pair. **Propose, never auto-act** — this only classifies.
 *
 * Tiers (exact-match v1; thresholds will iterate — that's why they live here):
 * - **high** — a shared exact contact *and* an equal folded name.
 * - **medium** — an equal folded name (no shared contact), *or* a shared exact
 *   contact (no name match): each is a strong standalone signal worth proposing.
 * - **low** — reserved for the future fuzzy tier; never returned in v1.
 * - **none** — no signal.
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
