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
 * Reconcile two versions of the same row (same `id`) into the surviving one.
 *
 * Rules:
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
 *
 * @throws if the two rows do not share an `id` (a caller bug — merge only ever
 * reconciles two versions of the *same* record).
 */
export function resolveMerge<T extends SyncRow>(a: T, b: T): T {
  if (a.id !== b.id) {
    throw new Error(
      `resolveMerge: cannot merge rows with different ids (${a.id} vs ${b.id})`,
    );
  }
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return a; // identical rows — idempotent
  return ca > cb ? a : b;
}
