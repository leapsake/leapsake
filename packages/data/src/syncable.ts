import type { SyncRow } from "@leapsake/schema";

/**
 * A repository the {@link SyncEngine} can drive. It is the *generic* contract
 * the engine needs over any one table — collect locally-changed rows, decode a
 * pulled JSON payload, and apply a peer's row via the merge — so the engine
 * stays schema-agnostic and one more synced entity is just one more entry in the
 * registry (plans/encryption/status.md, the "extend beyond `people`" step).
 *
 * Most domain repositories implement this directly on their repo object; a repo
 * that owns more than one table (tags + taggings, the three contact-method
 * tables) exposes one {@link SyncableRepo} per table instead.
 *
 * `getIncludingDeleted` is deliberately *not* here: it is the repo's own
 * internal merge-fetch detail, used inside {@link upsertFromRemote}.
 */
export interface SyncableRepo<T extends SyncRow> {
  /** The transport table tag for the records this repo owns, e.g. `'pets'`. */
  readonly table: string;
  /**
   * All rows with `updated_at > since`, **including tombstones**, ordered by
   * `updated_at` — the sync collector's source of locally-changed records (so
   * deletes propagate).
   */
  listChangedSince(since: number): Promise<T[]>;
  /**
   * Validate and shape a JSON payload pulled from a peer into a row of this
   * repo's type. Throws on an invalid payload (a corrupt or hostile relay).
   */
  decode(payload: unknown): T;
  /**
   * Apply a record pulled from a peer: reconcile it against the local row (if
   * any) via whole-row LWW (`resolveMerge`) and write the winner **verbatim**,
   * preserving the incoming `createdAt`/`updatedAt`/`deletedAt` (LWW only
   * converges if the clock stays the writer's).
   */
  upsertFromRemote(remote: T): Promise<void>;
}
