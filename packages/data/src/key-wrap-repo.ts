import {
  type AddKeyWrapInput,
  type KeyWrap,
  type PrincipalKind,
  type WrappedKind,
  addKeyWrapInputSchema,
  keyWrapSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `key_wrap` table row, exactly as stored (snake_case columns). */
interface KeyWrapRow {
  id: string;
  wrapped_kind: string;
  content_key_id: string | null;
  principal_kind: string;
  principal_ref: string | null;
  ciphertext: Uint8Array;
  alg: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Map a raw DB row to a validated `KeyWrap`. */
function toKeyWrap(row: KeyWrapRow): KeyWrap {
  return keyWrapSchema.parse({
    id: row.id,
    wrappedKind: row.wrapped_kind,
    contentKeyId: row.content_key_id,
    principalKind: row.principal_kind,
    principalRef: row.principal_ref,
    // node:sqlite hands back BLOBs as a Buffer; normalize to a plain
    // Uint8Array so callers (and the crypto primitives) get an exact type.
    ciphertext: Uint8Array.from(row.ciphertext),
    alg: row.alg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

/** Identifies a single active wrapping — the `key_wrap_active` index key. */
export interface ActiveKeyWrapQuery {
  wrappedKind: WrappedKind;
  contentKeyId?: string | null;
  principalKind: PrincipalKind;
  principalRef?: string | null;
}

export interface KeyWrapRepo {
  add(input: AddKeyWrapInput): Promise<KeyWrap>;
  getActive(query: ActiveKeyWrapQuery): Promise<KeyWrap | undefined>;
  revoke(id: string): Promise<void>;
}

/**
 * The universal-envelope repository (encryption-schema.md §2.4). Key material
 * is **append/revoke, never edited** (§1): you `add` a wrapping (grant) or
 * `revoke` one (soft-delete) — there is deliberately no update. Written against
 * the async {@link SqliteDriver} port so it runs unchanged on desktop and
 * mobile.
 */
export function createKeyWrapRepo(driver: SqliteDriver): KeyWrapRepo {
  return {
    async add(input) {
      const {
        wrappedKind,
        contentKeyId = null,
        principalKind,
        principalRef = null,
        ciphertext,
        alg,
      } = addKeyWrapInputSchema.parse(input);
      const now = Date.now();
      const keyWrap: KeyWrap = {
        id: crypto.randomUUID(),
        wrappedKind,
        contentKeyId,
        principalKind,
        principalRef,
        ciphertext,
        alg,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO key_wrap
           (id, wrapped_kind, content_key_id, principal_kind, principal_ref,
            ciphertext, alg, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          keyWrap.id,
          keyWrap.wrappedKind,
          keyWrap.contentKeyId,
          keyWrap.principalKind,
          keyWrap.principalRef,
          keyWrap.ciphertext,
          keyWrap.alg,
          keyWrap.createdAt,
          keyWrap.updatedAt,
          keyWrap.deletedAt,
        ],
      );
      return keyWrap;
    },

    async getActive({
      wrappedKind,
      contentKeyId = null,
      principalKind,
      principalRef = null,
    }) {
      // `IS ?` rather than `= ?` so nullable singleton columns
      // (content_key_id / principal_ref) match on NULL, matching the
      // `key_wrap_active` partial unique index exactly.
      const row = await driver.get<KeyWrapRow>(
        `SELECT * FROM key_wrap
         WHERE wrapped_kind = ?
           AND content_key_id IS ?
           AND principal_kind = ?
           AND principal_ref IS ?
           AND deleted_at IS NULL`,
        [wrappedKind, contentKeyId, principalKind, principalRef],
      );
      return row ? toKeyWrap(row) : undefined;
    },

    async revoke(id) {
      const now = Date.now();
      await driver.run(
        "UPDATE key_wrap SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        [now, now, id],
      );
    },
  };
}
