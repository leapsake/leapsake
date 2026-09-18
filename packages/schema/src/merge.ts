// Client-side merge for synced rows: whole-row last-writer-wins with
// tombstones, in an order-independent way (packages/sync/README.md).

/** The minimum every synced domain row carries; the merge needs nothing more. */
export interface SyncRow {
  id: string;
  /** Epoch ms, UTC. The LWW clock — bumped on every write, including delete. */
  updatedAt: number;
  /** Epoch ms when soft-deleted, else null. A tombstone, not a special case. */
  deletedAt: number | null;
}

/** JSON with sorted keys, so deeply equal rows serialize identically. */
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
 * Whether anything happened to a row after it was minted. It must read only the
 * row it is handed, or merging stops converging.
 */
export type HasHistory<T> = (row: T) => boolean;

/**
 * The surviving version of a row: one with history beats one without, then the
 * later `updatedAt`, then a stable tiebreak. A delete is an ordinary write.
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
