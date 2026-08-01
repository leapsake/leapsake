/**
 * Client-side merge for synced domain rows.
 *
 * Sync is a blind relay (see plans/encryption/sync.md): the server carries
 * already-encrypted records and never merges, so reconciliation of concurrent
 * edits happens here, on the client, over decrypted rows. The model is
 * **whole-row last-writer-wins (LWW) on `updatedAt`, with tombstones** — the
 * decision recorded in sync.md §4.
 *
 * The one property the rest of the design leans on is **order-independence**: a
 * device that pulls the same set of changes in any order must converge on the
 * same result, with no central clock or server-authoritative sequence (the P2P
 * invariant, sync.md §3). {@link resolveMerge} achieves this by being a `max`
 * over a *total order* on rows — and `max` is commutative, idempotent, and
 * associative, so folding a batch converges regardless of arrival order.
 *
 * One table may narrow that order with a {@link HasHistory} predicate — see
 * {@link resolveMerge} for the rule and the invariant it must not break.
 *
 * The sync-safe substrate this needs (UUID `id`, epoch-ms `updatedAt`, nullable
 * `deletedAt`) is already on every domain table (see AGENTS.md), so this
 * layer adds no columns and no migration.
 */

/** The minimum every synced domain row carries; the merge needs nothing more. */
export interface SyncRow {
  id: string;
  /** Epoch ms, UTC. The LWW clock — bumped on every write, including delete. */
  updatedAt: number;
  /** Epoch ms when soft-deleted, else null. A tombstone, not a special case. */
  deletedAt: number | null;
}

/**
 * Deterministic, recursive serialization with sorted object keys. Two rows that
 * are deeply equal produce the same string regardless of key insertion order,
 * so it is a stable identity for the tiebreak below. Pure; no dependency.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

/**
 * Whether a row carries **history** — anything that happened to it after the
 * code that mints it was done. Supplied per table (see `defineSyncable`), for
 * the one family that needs {@link resolveMerge}'s untouched-row rule.
 *
 * ⚠️ **It must be a function of the row it is handed, and nothing else.** Not of
 * the pair being merged, not of anything outside the row. That is the whole
 * reason the rule keeps order-independence, and the one way a later edit can
 * take it away silently — see {@link resolveMerge}.
 */
export type HasHistory<T> = (row: T) => boolean;

/**
 * Reconcile two versions of the same row (same `id`) into the surviving one.
 *
 * Rules:
 * - **A row with history beats one without**, whatever the clocks say — only
 *   when the caller supplies a `hasHistory` predicate; without one this rule
 *   does not exist and the merge is plain LWW. The case it answers: every device
 *   mints the engine-derived rows (the onboarding nudges) independently under
 *   the same deterministic id, so a device that mints *before* it pulls carries
 *   a newer `updatedAt` than the peer's tombstone and would otherwise undo a
 *   "don't ask again" or reset a snooze. **Derived data can be recomputed and a
 *   user's decision cannot**: losing a mint costs nothing, because the next
 *   reconcile re-derives it. (onboarding.md §1, owner, 2026-08-01.)
 * - **Higher `updatedAt` wins** — whole-row last-writer-wins.
 * - **Equal `updatedAt` is broken deterministically** by canonical-serialization
 *   order, so two devices that wrote in the same millisecond still converge on
 *   the same winner without consulting any central authority. (Truly concurrent
 *   same-ms edits are rare for this single-user, few-device workload; the
 *   tiebreak exists for convergence, not because it happens often.)
 * - **Deletes are not special.** A soft delete bumps `updatedAt` alongside
 *   `deletedAt`, so it competes like any other write: a later delete beats an
 *   earlier edit, and a later edit beats an earlier delete (resurrection). That
 *   is the deliberate LWW semantics.
 *
 * Together these define a total order on rows — `resolveMerge` returns the
 * maximum — which is what makes it commutative, idempotent, and associative.
 * The sort key is `(hasHistory(row), updatedAt, canonical(row))`, and **every
 * component is a function of one row alone**. That is the invariant to protect:
 * a predicate that consulted the *pair* would still pass every two-row test and
 * would stop devices converging, which nothing here would notice. The
 * permutation test in `merge.test.ts` is the one that would.
 *
 * @throws if the two rows do not share an `id` (a caller bug — merge only ever
 * reconciles two versions of the *same* record).
 */
export function resolveMerge<T extends SyncRow>(
  a: T,
  b: T,
  hasHistory?: HasHistory<T>,
): T {
  if (a.id !== b.id) {
    throw new Error(
      `resolveMerge: cannot merge rows with different ids (${a.id} vs ${b.id})`,
    );
  }
  if (hasHistory !== undefined) {
    const ha = hasHistory(a);
    const hb = hasHistory(b);
    if (ha !== hb) return ha ? a : b;
  }
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return a; // identical rows — idempotent
  return ca > cb ? a : b;
}
