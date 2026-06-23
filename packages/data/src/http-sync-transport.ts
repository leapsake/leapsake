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
 * The account-registration payload a device-1 hands the relay at enable-sync,
 * minus the credentials the transport already holds (`accountId`/`authVerifier`,
 * supplied at construction). It carries the public salt and the *ciphertext*
 * `wrap(MK, password-KEK)` so a future second device can log in and recover the
 * master key — the relay stores both but can read neither (multi-device-login.md).
 */
export interface AccountRegistration {
  /** Unique login handle the second device looks the account up by. */
  username: string;
  /** Public Argon2id salt (model.md §9.3). */
  kdfSalt: Uint8Array;
  /** Ciphertext `wrap(MK, KEK)` — the protected symmetric key. */
  wrappedMasterKey: Uint8Array;
  /** Ciphertext `wrap(MK, recoveryKey)` — the recovery escrow (model.md §6). */
  wrappedMasterKeyRecovery: Uint8Array;
  /** The recovery auth verifier; the relay stores only its hash. */
  recoveryVerifier: Uint8Array;
}

/**
 * A {@link SyncTransport} plus the extra calls the engine never needs — the
 * account-bootstrap channel that lets a *second* device obtain the master key
 * (multi-device-login.md). These are adoption concerns, not sync concerns, so
 * they live outside the port; the engine only ever touches `push`/`pull`.
 *
 * `accountId`/`authVerifier` are optional at construction: a *joining* device
 * does not know them until after {@link HttpSyncTransport.lookup}, so a
 * credential-less transport drives the whole bootstrap (lookup → fetchBootstrap).
 * The sync calls (`register`/`push`/`pull`) throw if built without them.
 */
export interface HttpSyncTransport extends SyncTransport {
  /**
   * Register this account with the relay. Sends the construction-time auth
   * verifier (the relay stores only its hash, model.md §9.3) plus the public
   * salt, unique username, and wrapped master key. Duplicate username → the
   * relay answers 409, surfaced here as a throw.
   */
  register(registration: AccountRegistration): Promise<void>;
  /**
   * Unauthed prelogin: resolve a username to its account id + public salt, so a
   * joining device can derive the KEK and authenticate. Throws if the username
   * is unknown (relay 404).
   */
  lookup(username: string): Promise<{ accountId: string; kdfSalt: Uint8Array }>;
  /**
   * Bearer-authed: fetch this account's `wrap(MK, KEK)` ciphertext so the
   * joining device can unwrap the master key locally. Takes the freshly-derived
   * credentials as an argument — the joining device computes them from the
   * password + the salt that {@link HttpSyncTransport.lookup} returned, so they
   * are not known at construction. A wrong password yields a wrong verifier →
   * the relay answers 401, surfaced here as a throw (before any unwrap).
   */
  fetchBootstrap(creds: {
    accountId: string;
    authVerifier: Uint8Array;
  }): Promise<Uint8Array>;
  /**
   * Recovery-authed: prove possession of the recovery key (its verifier) to fetch
   * `wrap(MK, recoveryKey)` so a device that lost its password can unwrap the
   * master key (model.md §6). A wrong recovery key → wrong verifier → relay 401.
   */
  fetchRecovery(creds: {
    accountId: string;
    recoveryVerifier: Uint8Array;
  }): Promise<Uint8Array>;
  /**
   * Recovery-authed: replace the account's password door (verifier, salt, and
   * `wrap(MK, KEK)`) with freshly chosen-password material. How a recovered
   * device re-establishes a working relay credential after recovery.
   */
  resetCredentials(args: {
    accountId: string;
    recoveryVerifier: Uint8Array;
    authVerifier: Uint8Array;
    kdfSalt: Uint8Array;
    wrappedMasterKey: Uint8Array;
  }): Promise<void>;
}

export function createHttpSyncTransport(opts: {
  /** Relay origin, e.g. `https://relay.leapsake.app` (no trailing slash needed). */
  baseUrl: string;
  /**
   * The account UUID — the relay's per-account namespace. Optional: a joining
   * device omits it until {@link HttpSyncTransport.lookup} resolves it.
   */
  accountId?: string;
  /**
   * The §9.3 auth verifier; the bearer credential proving account ownership.
   * Optional alongside `accountId` (both or neither).
   */
  authVerifier?: Uint8Array;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetch?: typeof fetch;
}): HttpSyncTransport {
  const { accountId, authVerifier } = opts;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;

  // `<accountId>.<base64(verifier)>` — the account UUID never contains a `.` and
  // base64 never produces one, so the relay splits on the first `.` unambiguously.
  // Built only when credentials were supplied (sync / post-join usage).
  const bearer =
    accountId !== undefined && authVerifier !== undefined
      ? `${accountId}.${bytesToBase64(authVerifier)}`
      : undefined;

  async function authed(path: string, init: RequestInit): Promise<Response> {
    if (bearer === undefined) {
      throw new Error(
        "this transport has no credentials — construct it with accountId + authVerifier",
      );
    }
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
    async register(registration) {
      if (accountId === undefined || authVerifier === undefined) {
        throw new Error("register requires accountId + authVerifier");
      }
      const res = await doFetch(`${base}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          username: registration.username,
          authVerifier: bytesToBase64(authVerifier),
          kdfSalt: bytesToBase64(registration.kdfSalt),
          wrappedMasterKey: bytesToBase64(registration.wrappedMasterKey),
          wrappedMasterKeyRecovery: bytesToBase64(
            registration.wrappedMasterKeyRecovery,
          ),
          recoveryVerifier: bytesToBase64(registration.recoveryVerifier),
        }),
      });
      if (!res.ok) throw new Error(`relay register failed: ${res.status}`);
    },

    async lookup(username) {
      const res = await doFetch(
        `${base}/accounts/lookup?username=${encodeURIComponent(username)}`,
        { method: "GET" },
      );
      if (!res.ok) throw new Error(`relay lookup failed: ${res.status}`);
      const body = (await res.json()) as {
        accountId: string;
        kdfSalt: string;
      };
      return {
        accountId: body.accountId,
        kdfSalt: base64ToBytes(body.kdfSalt),
      };
    },

    async fetchBootstrap(creds) {
      // Build the bearer from the *passed* credentials, not construction ones —
      // a joining device derives these only after `lookup`.
      const bootstrapBearer = `${creds.accountId}.${bytesToBase64(creds.authVerifier)}`;
      const res = await doFetch(`${base}/accounts/bootstrap`, {
        method: "GET",
        headers: { authorization: `Bearer ${bootstrapBearer}` },
      });
      if (!res.ok) {
        throw new Error(`relay GET /accounts/bootstrap failed: ${res.status}`);
      }
      const body = (await res.json()) as { wrappedMasterKey: string };
      return base64ToBytes(body.wrappedMasterKey);
    },

    async fetchRecovery(creds) {
      // A distinct `Recovery` scheme so the relay checks the recovery-verifier
      // hash, not the password one. `<accountId>.<base64(recoveryVerifier)>`.
      const token = `${creds.accountId}.${bytesToBase64(creds.recoveryVerifier)}`;
      const res = await doFetch(`${base}/accounts/recovery`, {
        method: "GET",
        headers: { authorization: `Recovery ${token}` },
      });
      if (!res.ok) {
        throw new Error(`relay GET /accounts/recovery failed: ${res.status}`);
      }
      const body = (await res.json()) as { wrappedMasterKeyRecovery: string };
      return base64ToBytes(body.wrappedMasterKeyRecovery);
    },

    async resetCredentials(args) {
      const token = `${args.accountId}.${bytesToBase64(args.recoveryVerifier)}`;
      const res = await doFetch(`${base}/accounts/reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Recovery ${token}`,
        },
        body: JSON.stringify({
          authVerifier: bytesToBase64(args.authVerifier),
          kdfSalt: bytesToBase64(args.kdfSalt),
          wrappedMasterKey: bytesToBase64(args.wrappedMasterKey),
        }),
      });
      if (!res.ok) {
        throw new Error(`relay POST /accounts/reset failed: ${res.status}`);
      }
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
