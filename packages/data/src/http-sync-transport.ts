import { base64ToBytes, bytesToBase64 } from "@leapsake/crypto";
import type {
  Cursor,
  EncryptedRecord,
  SyncTransport,
} from "./sync-transport.js";

/**
 * The real {@link SyncTransport} adapter: an authenticated HTTPS client for the
 * blind relay (plans/encryption/sync.md §2). It is the production counterpart to
 * `createInMemoryTransport` — same port, same blindness contract — so the
 * {@link SyncEngine} consumes it unchanged.
 *
 * The relay is a *dumb pipe for ciphertext* (sync.md §1): everything it carries
 * is already sealed, so this adapter only base64-encodes the binary fields for
 * JSON transit and attaches the account's bearer credential. It never holds a
 * master key and never merges.
 */

/**
 * One {@link EncryptedRecord} as it travels over JSON: the binary fields
 * ({@link EncryptedRecord.ciphertext}, {@link EncryptedRecord.wrappedKey}) are
 * base64 strings; everything else is the cleartext sync metadata the relay is
 * allowed to see. This is the single source of truth for the wire shape — the
 * relay server imports it so the two ends cannot drift.
 */
export interface WireRecord {
  id: string;
  table: string;
  updatedAt: number;
  deletedAt: number | null;
  ciphertext: string;
  wrappedKey?: string;
}

/** {@link EncryptedRecord} → {@link WireRecord} (base64 the binary fields). */
export function encodeRecord(record: EncryptedRecord): WireRecord {
  const wire: WireRecord = {
    id: record.id,
    table: record.table,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    ciphertext: bytesToBase64(record.ciphertext),
  };
  if (record.wrappedKey !== undefined) {
    wire.wrappedKey = bytesToBase64(record.wrappedKey);
  }
  return wire;
}

/** {@link WireRecord} → {@link EncryptedRecord} (decode the base64 fields). */
export function decodeRecord(wire: WireRecord): EncryptedRecord {
  const record: EncryptedRecord = {
    id: wire.id,
    table: wire.table,
    updatedAt: wire.updatedAt,
    deletedAt: wire.deletedAt,
    ciphertext: base64ToBytes(wire.ciphertext),
  };
  if (wire.wrappedKey !== undefined) {
    record.wrappedKey = base64ToBytes(wire.wrappedKey);
  }
  return record;
}

/**
 * A {@link SyncTransport} plus the one extra setup call the engine never needs:
 * {@link HttpSyncTransport.register}, which announces the account to the relay
 * so its later push/pull are authorized. Registration is a transport concern,
 * not a core one — the enable-sync flow calls it once (a later apps slice); the
 * engine only ever touches `push`/`pull`.
 */
export interface HttpSyncTransport extends SyncTransport {
  /**
   * Register this account with the relay (idempotent). Sends the auth verifier —
   * the relay stores only a hash of it (model.md §9.3) — and the public KDF salt
   * so a future second device can fetch it to log in.
   */
  register(kdfSalt: Uint8Array): Promise<void>;
}

export function createHttpSyncTransport(opts: {
  /** Relay origin, e.g. `https://relay.leapsake.app` (no trailing slash needed). */
  baseUrl: string;
  /** The account UUID — the relay's per-account namespace. */
  accountId: string;
  /** The §9.3 auth verifier; the bearer credential proving account ownership. */
  authVerifier: Uint8Array;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetch?: typeof fetch;
}): HttpSyncTransport {
  const { accountId, authVerifier } = opts;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;

  // `<accountId>.<base64(verifier)>` — the account UUID never contains a `.` and
  // base64 never produces one, so the relay splits on the first `.` unambiguously.
  const bearer = `${accountId}.${bytesToBase64(authVerifier)}`;

  async function authed(path: string, init: RequestInit): Promise<Response> {
    const res = await doFetch(`${base}/${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) {
      throw new Error(
        `relay ${init.method ?? "GET"} /${path} failed: ${res.status}`,
      );
    }
    return res;
  }

  return {
    async register(kdfSalt) {
      const res = await doFetch(`${base}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          authVerifier: bytesToBase64(authVerifier),
          kdfSalt: bytesToBase64(kdfSalt),
        }),
      });
      if (!res.ok) throw new Error(`relay register failed: ${res.status}`);
    },

    async push(records) {
      await authed("sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: records.map(encodeRecord) }),
      });
    },

    async pull(since: Cursor) {
      const res = await authed(`sync/pull?since=${since}`, { method: "GET" });
      const body = (await res.json()) as {
        records: WireRecord[];
        cursor: Cursor;
      };
      return { records: body.records.map(decodeRecord), cursor: body.cursor };
    },
  };
}
