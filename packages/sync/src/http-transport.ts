import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import type { Cursor, EncryptedRecord, SyncTransport } from "./transport.js";

// The blind relay's HTTPS adapter, carrying only sealed records; see the
// README's _Sessions_ for how it authenticates.

/** An {@link EncryptedRecord} on the wire, binary fields as base64; the relay
 *  imports this too, so the two ends cannot drift. */
export interface WireRecord {
  id: string;
  table: string;
  updatedAt: number;
  deletedAt: number | null;
  ciphertext: string;
  wrappedKey?: string;
}

/** Encodes an {@link EncryptedRecord} as a {@link WireRecord}. */
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

/** Decodes a {@link WireRecord} back to an {@link EncryptedRecord}. */
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

/** What a first device registers with the relay, beside the transport's own
 *  credentials; all of it public salt or ciphertext. */
export interface AccountRegistration {
  /** Unique login handle the second device looks the account up by. */
  username: string;
  /** The public Argon2id salt. */
  kdfSalt: Uint8Array;
  /** Ciphertext `wrap(MK, KEK)`. */
  wrappedMasterKey: Uint8Array;
  /** Ciphertext `wrap(recoveryKey, MK)`, so every device reveals one phrase. */
  wrappedRecoveryKey: Uint8Array;
  /** Ciphertext `wrap(MK, recoveryKey)`: the recovery escrow. */
  wrappedMasterKeyRecovery: Uint8Array;
  /** The recovery auth verifier; the relay stores only its hash. */
  recoveryVerifier: Uint8Array;
}

/** A {@link SyncTransport} plus the account-bootstrap calls; built without
 *  credentials, it serves a joining device, and sync calls throw. */
export interface HttpSyncTransport extends SyncTransport {
  /** Registers this account with the relay; a taken username throws its 409. */
  register(registration: AccountRegistration): Promise<void>;
  /** Unauthenticated: a username's account id and salt; throws the 404. */
  lookup(username: string): Promise<{ accountId: string; kdfSalt: Uint8Array }>;
  /** Fetches `wrap(MK, KEK)` with credentials derived after `lookup`; a wrong
   *  password throws the relay's 401 before any unwrap. */
  fetchBootstrap(creds: {
    accountId: string;
    authVerifier: Uint8Array;
  }): Promise<{
    wrappedMasterKey: Uint8Array;
    wrappedRecoveryKey?: Uint8Array;
  }>;
  /** Fetches `wrap(MK, recoveryKey)` on the recovery verifier; wrong is 401. */
  fetchRecovery(creds: {
    accountId: string;
    recoveryVerifier: Uint8Array;
  }): Promise<Uint8Array>;
  /** Replaces the recovery door, on the password verifier, so a leaked phrase
   *  cannot rotate itself. */
  publishRecovery(args: {
    accountId: string;
    authVerifier: Uint8Array;
    wrappedRecoveryKey: Uint8Array;
    wrappedMasterKeyRecovery: Uint8Array;
    recoveryVerifier: Uint8Array;
  }): Promise<void>;
  /** Replaces the password door, on the recovery verifier, after a recovery. */
  resetCredentials(args: {
    accountId: string;
    recoveryVerifier: Uint8Array;
    authVerifier: Uint8Array;
    kdfSalt: Uint8Array;
    wrappedMasterKey: Uint8Array;
  }): Promise<void>;
}

export function createHttpSyncTransport(opts: {
  /** The relay's origin, such as `https://relay.leapsake.app`. */
  baseUrl: string;
  /** The account UUID; a joining device omits it until `lookup`. */
  accountId?: string;
  /** The auth verifier proving ownership; both or neither with `accountId`. */
  authVerifier?: Uint8Array;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetch?: typeof fetch;
}): HttpSyncTransport {
  const { accountId, authVerifier } = opts;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;

  // The hot path's session token, in memory only.
  interface Session {
    token: string;
    expiresAt: number;
  }
  let session: Session | undefined;

  // Log in a little early, so a request never races the expiry.
  const SESSION_REFRESH_SKEW_MS = 30_000;

  /** Trades the verifier for a session token; the bearer is
   *  `<accountId>.<base64(verifier)>`, neither half holding a `.`. */
  async function login(): Promise<Session> {
    if (accountId === undefined || authVerifier === undefined) {
      throw new Error(
        "this transport has no credentials — construct it with accountId + authVerifier",
      );
    }
    const verifierBearer = `${accountId}.${bytesToBase64(authVerifier)}`;
    const res = await doFetch(`${base}/accounts/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${verifierBearer}` },
    });
    if (!res.ok) {
      throw new Error(`relay POST /accounts/session failed: ${res.status}`);
    }
    session = (await res.json()) as Session;
    return session;
  }

  /** The cached session if still fresh, else a freshly-logged-in one. */
  function ensureSession(): Promise<Session> {
    if (
      session !== undefined &&
      Date.now() < session.expiresAt - SESSION_REFRESH_SKEW_MS
    ) {
      return Promise.resolve(session);
    }
    return login();
  }

  /** A session-authed request that logs in again once on a 401; a login's own
   *  401 propagates as the password-reset signal. */
  async function authed(path: string, init: RequestInit): Promise<Response> {
    let current = await ensureSession();
    const send = (): Promise<Response> =>
      doFetch(`${base}/${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Session ${current.token}` },
      });

    let res = await send();
    if (res.status === 401) {
      session = undefined;
      current = await login();
      res = await send();
    }
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
          wrappedRecoveryKey: bytesToBase64(registration.wrappedRecoveryKey),
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
      // The passed credentials: a joining device derives them after `lookup`.
      const bootstrapBearer = `${creds.accountId}.${bytesToBase64(creds.authVerifier)}`;
      const res = await doFetch(`${base}/accounts/bootstrap`, {
        method: "GET",
        headers: { authorization: `Bearer ${bootstrapBearer}` },
      });
      if (!res.ok) {
        throw new Error(`relay GET /accounts/bootstrap failed: ${res.status}`);
      }
      const body = (await res.json()) as {
        wrappedMasterKey: string;
        // Absent from an older relay's accounts.
        wrappedRecoveryKey?: string;
      };
      return {
        wrappedMasterKey: base64ToBytes(body.wrappedMasterKey),
        wrappedRecoveryKey:
          body.wrappedRecoveryKey === undefined
            ? undefined
            : base64ToBytes(body.wrappedRecoveryKey),
      };
    },

    async fetchRecovery(creds) {
      // A `Recovery` scheme, so the relay checks the recovery verifier's hash.
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

    async publishRecovery(args) {
      // The password verifier as a `Bearer`; the relay refuses `Recovery` here.
      const bearer = `${args.accountId}.${bytesToBase64(args.authVerifier)}`;
      const res = await doFetch(`${base}/accounts/recovery`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          wrappedRecoveryKey: bytesToBase64(args.wrappedRecoveryKey),
          wrappedMasterKeyRecovery: bytesToBase64(
            args.wrappedMasterKeyRecovery,
          ),
          recoveryVerifier: bytesToBase64(args.recoveryVerifier),
        }),
      });
      if (!res.ok) {
        throw new Error(`relay POST /accounts/recovery failed: ${res.status}`);
      }
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
