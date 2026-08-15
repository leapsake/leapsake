import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import type { Cursor, EncryptedRecord, SyncTransport } from "./transport.js";

/**
 * The real {@link SyncTransport} adapter: an authenticated HTTPS client for the
 * blind relay (plans/encryption/sync.md §2). It is the production counterpart to
 * `createInMemoryTransport` — same port, same blindness contract — so the
 * {@link SyncEngine} consumes it unchanged.
 *
 * The relay is a *dumb pipe for ciphertext* (sync.md §1): everything it carries
 * is already sealed, so this adapter only base64-encodes the binary fields for
 * JSON transit and attaches the account's credential. It never holds a master key
 * and never merges.
 *
 * **Sessions (security-findings.md H3).** The hot `push`/`pull` path authenticates
 * with a short-lived **session token**, not the password-derived verifier — so the
 * verifier transits only *once per login*. This adapter manages that lifecycle
 * itself, invisibly: it logs in with the verifier on first use (and near expiry),
 * caches the token in memory, and on a 401 re-logs-in once and retries. Everything
 * above it — the {@link SyncEngine}, `core`, the apps — is unchanged; a re-login
 * that *itself* 401s (the verifier is now stale, e.g. the password was reset on
 * another device) propagates as a `401` error, the signal the clients already read.
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
 * master key — the relay stores both but can read neither.
 */
export interface AccountRegistration {
  /** Unique login handle the second device looks the account up by. */
  username: string;
  /** Public Argon2id salt (model.md §9.3). */
  kdfSalt: Uint8Array;
  /** Ciphertext `wrap(MK, KEK)` — the protected symmetric key. */
  wrappedMasterKey: Uint8Array;
  /**
   * Ciphertext `wrap(recoveryKey, MK)` — the inverse escrow that lets a
   * password-joining device recover the account recovery key from MK alone, so
   * every device reveals one phrase.
   */
  wrappedRecoveryKey: Uint8Array;
  /** Ciphertext `wrap(MK, recoveryKey)` — the recovery escrow (model.md §6). */
  wrappedMasterKeyRecovery: Uint8Array;
  /** The recovery auth verifier; the relay stores only its hash. */
  recoveryVerifier: Uint8Array;
}

/**
 * A {@link SyncTransport} plus the extra calls the engine never needs — the
 * account-bootstrap channel that lets a *second* device obtain the master key
 * (`plans/encryption/sync.md` → *The account-bootstrap channel*). These are
 * adoption concerns, not sync concerns, so
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
  }): Promise<{
    wrappedMasterKey: Uint8Array;
    wrappedRecoveryKey?: Uint8Array;
  }>;
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
   * Bearer-authed: replace the account's **recovery** door after a phrase rotation
   * (custody slice 8) — the escrow a fresh device recovers from, its inverse, and
   * the verifier hash that authenticates a recovery. Authenticated with the
   * *password* verifier, not the recovery one: a leaked phrase must not be able to
   * rotate itself.
   *
   * Takes the credentials as an argument rather than reading the construction-time
   * ones so the caller can rotate on a transport it built for the account, in the
   * same shape {@link HttpSyncTransport.fetchBootstrap} uses.
   */
  publishRecovery(args: {
    accountId: string;
    authVerifier: Uint8Array;
    wrappedRecoveryKey: Uint8Array;
    wrappedMasterKeyRecovery: Uint8Array;
    recoveryVerifier: Uint8Array;
  }): Promise<void>;
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

  // The live session token for the hot path, or undefined until first login. Held
  // in memory only — it is ephemeral per-device state, never persisted or synced.
  interface Session {
    token: string;
    expiresAt: number;
  }
  let session: Session | undefined;

  // Log in a touch before the token actually expires, so a request never races a
  // mid-flight expiry (the 401 retry below is the backstop if it does anyway).
  const SESSION_REFRESH_SKEW_MS = 30_000;

  /**
   * Exchange the durable verifier for a fresh session token (`POST
   * /accounts/session`). The verifier bearer is `<accountId>.<base64(verifier)>`
   * — the account UUID never contains a `.` and base64 never produces one, so the
   * relay splits on the first `.` unambiguously. A wrong/stale verifier → relay
   * 401, surfaced as a throw (which the clients read as "re-authenticate").
   */
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

  /**
   * Perform a session-authed request, managing the token lifecycle: ensure a live
   * session (logging in on first use / near expiry), then attach it. A 401 means
   * the session was invalidated server-side (expired, or the relay restarted and
   * lost its in-memory sessions) — re-login once and retry. If that re-login
   * *itself* 401s (verifier now stale), it propagates, preserving the clients'
   * password-reset signal.
   */
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
      const body = (await res.json()) as {
        wrappedMasterKey: string;
        // Optional for back-compat with a pre-unification relay.
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

    async publishRecovery(args) {
      // The password verifier, in the same `Bearer <accountId>.<verifier>` form
      // `fetchBootstrap` uses — the relay refuses a `Recovery` token here.
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
