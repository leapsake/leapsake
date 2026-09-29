import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import { decodeRecord, encodeRecord } from "@leapsake/sync";
import proxyaddr from "proxy-addr";
import { z } from "zod";
import {
  DEFAULT_BOOTSTRAP_RATE_LIMIT,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RECOVERY_RATE_LIMIT,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_TRUSTED_PROXIES,
  ENV,
  type RateLimit,
} from "./config.js";
import type { RelayStore } from "./store.js";

// Part of `createRelayServer`'s options, so importable from here too.
export type { RateLimit };

// The blind relay: routes, auth and throttles are in the README's _Routes_
// and _Auth (blind)_.

// Trust-boundary validation: every field off the wire is parsed.

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "expected base64");

const registerBodySchema = z.object({
  accountId: z.uuid(),
  username: z.string().min(1),
  authVerifier: base64,
  kdfSalt: base64,
  wrappedMasterKey: base64,
  // wrap(recoveryKey, MK), so a joining device reveals the account phrase.
  wrappedRecoveryKey: base64.optional(),
  // The recovery escrow; current clients always send it.
  wrappedMasterKeyRecovery: base64.optional(),
  recoveryVerifier: base64.optional(),
});

/** Recovery-authenticated password reset: new password-door material. */
const resetBodySchema = z.object({
  authVerifier: base64,
  kdfSalt: base64,
  wrappedMasterKey: base64,
});

/** Password-authenticated rotation: all three recovery fields, required. */
const rotateRecoveryBodySchema = z.object({
  wrappedRecoveryKey: base64,
  wrappedMasterKeyRecovery: base64,
  recoveryVerifier: base64,
});

const wireRecordSchema = z.object({
  id: z.string(),
  table: z.string(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
  ciphertext: base64,
  wrappedKey: base64.optional(),
});

const pushBodySchema = z.object({ records: z.array(wireRecordSchema) });

// Helpers

function sha256(input: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(input).digest());
}

/** The registration-token gate: open when unset, else a constant-time match
 *  on `X-Registration-Token`. */
function registrationTokenOk(req: IncomingMessage): boolean {
  const expected = process.env[ENV.registrationToken];
  if (expected === undefined || expected === "") return true;
  const presented = req.headers["x-registration-token"];
  if (typeof presented !== "string") return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A fixed-window, per-IP limiter, swept once a window to stay small. */
function createRateLimiter(limit: RateLimit): (ip: string) => boolean {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;
  return function allow(ip: string): boolean {
    const now = Date.now();
    if (now >= nextSweepAt) {
      for (const [key, entry] of hits) {
        if (now >= entry.resetAt) hits.delete(key);
      }
      nextSweepAt = now + limit.windowMs;
    }
    const entry = hits.get(ip);
    if (entry === undefined || now >= entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (entry.count >= limit.max) return false;
    entry.count += 1;
    return true;
  };
}

class BodyTooLargeError extends Error {}

/** Buffers the body; past `maxBytes`, a {@link BodyTooLargeError}. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.removeAllListeners("data");
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

/** Answers 413 and closes, dropping the rest of the body unbuffered. */
function sendTooLarge(res: ServerResponse): void {
  res.setHeader("connection", "close");
  sendJson(res, 413, { error: "payload too large" });
}

/** The account a verifier bearer authenticates, or `null` on any failure. */
function authenticate(req: IncomingMessage, store: RelayStore): string | null {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);

  // Split on the first `.`: neither a UUID nor base64 contains one.
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const accountId = token.slice(0, dot);
  const verifierB64 = token.slice(dot + 1);

  const account = store.getAccount(accountId);
  if (account === undefined) return null;

  let presented: Uint8Array;
  try {
    presented = base64ToBytes(verifierB64);
  } catch {
    return null;
  }
  const presentedHash = sha256(presented);
  if (presentedHash.length !== account.authVerifierHash.length) return null;
  if (!timingSafeEqual(presentedHash, account.authVerifierHash)) return null;

  return accountId;
}

/** The account a `Recovery` credential authenticates, or `null`; a scheme of
 *  its own, so the doors never cross-authenticate. */
function authenticateRecovery(
  req: IncomingMessage,
  store: RelayStore,
): string | null {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Recovery ")) return null;
  const token = header.slice("Recovery ".length);

  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const accountId = token.slice(0, dot);
  const verifierB64 = token.slice(dot + 1);

  const account = store.getAccount(accountId);
  if (account === undefined || account.recoveryVerifierHash === undefined) {
    return null;
  }

  let presented: Uint8Array;
  try {
    presented = base64ToBytes(verifierB64);
  } catch {
    return null;
  }
  const presentedHash = sha256(presented);
  if (presentedHash.length !== account.recoveryVerifierHash.length) return null;
  if (!timingSafeEqual(presentedHash, account.recoveryVerifierHash)) {
    return null;
  }

  return accountId;
}

// The server

export function createRelayServer(opts: {
  store: RelayStore;
  /** Per-IP throttle on the unauthenticated endpoints. */
  rateLimit?: RateLimit;
  /** Per-IP throttle on the recovery-authenticated endpoints. */
  recoveryRateLimit?: RateLimit;
  /** Per-IP throttle on failed logins, on a counter of its own. */
  bootstrapRateLimit?: RateLimit;
  /** Proxies trusted to set `X-Forwarded-For`; see
   *  {@link DEFAULT_TRUSTED_PROXIES}. */
  trustedProxies?: readonly string[];
  /** A session token's lifetime in ms; see {@link DEFAULT_SESSION_TTL_MS}. */
  sessionTtlMs?: number;
  /** The largest request body read, in bytes. */
  maxBodyBytes?: number;
  /** In-process TLS (Option B); omitted, TLS terminates in front (Option A). */
  tls?: { cert: string | Buffer; key: string | Buffer; passphrase?: string };
}): Server {
  const { store } = opts;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allow = createRateLimiter(opts.rateLimit ?? DEFAULT_RATE_LIMIT);
  // Its own counter, independent of the enumeration budget.
  const allowRecovery = createRateLimiter(
    opts.recoveryRateLimit ?? DEFAULT_RECOVERY_RATE_LIMIT,
  );
  // A third counter, for failed logins (threat H2).
  const allowBootstrap = createRateLimiter(
    opts.bootstrapRateLimit ?? DEFAULT_BOOTSTRAP_RATE_LIMIT,
  );

  // proxy-addr hops trusted addresses from the socket end and returns the first
  // untrusted one; with none trusted, the socket address.
  const trust = proxyaddr.compile([
    ...(opts.trustedProxies ?? DEFAULT_TRUSTED_PROXIES),
  ]);
  const clientIp = (req: IncomingMessage): string => proxyaddr(req, trust);

  /** Throttles by client IP; answers 429 and returns true if over. */
  function throttled(req: IncomingMessage, res: ServerResponse): boolean {
    if (allow(clientIp(req))) return false;
    sendJson(res, 429, { error: "rate limited" });
    return true;
  }

  /** Throttles a recovery request; call it before authenticating, or it never
   *  sees the rejected guesses. */
  function throttledRecovery(
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    if (allowRecovery(clientIp(req))) return false;
    sendJson(res, 429, { error: "rate limited" });
    return true;
  }

  // Sessions by token hash, in memory; see the README's _Routes_.
  const sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessions = new Map<string, { accountId: string; expiresAt: number }>();

  /** Drops expired sessions, on each mint, so the map stays bounded. */
  function purgeExpiredSessions(now: number): void {
    for (const [key, session] of sessions) {
      if (now >= session.expiresAt) sessions.delete(key);
    }
  }

  /** Mints a session token for an authenticated account. */
  function mintSession(accountId: string): {
    token: string;
    expiresAt: number;
  } {
    const now = Date.now();
    purgeExpiredSessions(now);
    const raw = Uint8Array.from(randomBytes(32));
    const expiresAt = now + sessionTtlMs;
    sessions.set(bytesToBase64(sha256(raw)), { accountId, expiresAt });
    return { token: bytesToBase64(raw), expiresAt };
  }

  /** The account a live `Session` token authenticates, or `null`. */
  function authenticateSession(req: IncomingMessage): string | null {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Session ")) return null;
    const token = header.slice("Session ".length);

    let presented: Uint8Array;
    try {
      presented = base64ToBytes(token);
    } catch {
      return null;
    }
    const key = bytesToBase64(sha256(presented));
    const session = sessions.get(key);
    if (session === undefined) return null;
    if (Date.now() >= session.expiresAt) {
      sessions.delete(key);
      return null;
    }
    return session.accountId;
  }

  /** Read and parse a JSON body, or answer 413 or 400 and return undefined. */
  async function readJson(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<unknown> {
    let text: string;
    try {
      text = await readBody(req, maxBodyBytes);
    } catch (error) {
      if (!(error instanceof BodyTooLargeError)) throw error;
      sendTooLarge(res);
      return undefined;
    }
    try {
      return JSON.parse(text || "{}");
    } catch {
      sendJson(res, 400, { error: "invalid request" });
      return undefined;
    }
  }

  // One listener over HTTP or HTTPS.
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    });
  };

  // Option B serves HTTPS only, with no port-80 redirect.
  return opts.tls === undefined
    ? createHttpServer(listener)
    : createHttpsServer(opts.tls, listener);

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (Number(req.headers["content-length"] ?? 0) > maxBodyBytes) {
      sendTooLarge(res);
      return;
    }
    const url = new URL(req.url ?? "/", "http://relay");
    const { method } = req;

    if (method === "POST" && url.pathname === "/accounts") {
      if (throttled(req, res)) return;
      // Access control, checked before anything is stored.
      if (!registrationTokenOk(req)) {
        sendJson(res, 401, { error: "registration token required" });
        return;
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const parsed = registerBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      const {
        accountId,
        username,
        authVerifier,
        kdfSalt,
        wrappedMasterKey,
        wrappedRecoveryKey,
        wrappedMasterKeyRecovery,
        recoveryVerifier,
      } = parsed.data;
      const result = store.registerAccount(
        accountId,
        username.trim().toLowerCase(),
        sha256(base64ToBytes(authVerifier)),
        base64ToBytes(kdfSalt),
        base64ToBytes(wrappedMasterKey),
        wrappedRecoveryKey === undefined
          ? undefined
          : base64ToBytes(wrappedRecoveryKey),
        wrappedMasterKeyRecovery === undefined
          ? undefined
          : base64ToBytes(wrappedMasterKeyRecovery),
        recoveryVerifier === undefined
          ? undefined
          : sha256(base64ToBytes(recoveryVerifier)),
      );
      if (result === "username-taken") {
        sendJson(res, 409, { error: "username taken" });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/accounts/lookup") {
      if (throttled(req, res)) return;
      // Prelogin: a joining device needs the id and salt to derive its KEK.
      const username = (url.searchParams.get("username") ?? "")
        .trim()
        .toLowerCase();
      const account =
        username === "" ? undefined : store.getAccountByUsername(username);
      if (account === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        accountId: account.accountId,
        kdfSalt: bytesToBase64(account.kdfSalt),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/accounts/session") {
      // The login: the verifier once, for a session token (threat H3).
      const accountId = authenticate(req, store);
      if (accountId === null) {
        // The same guessing surface as bootstrap, so the same budget.
        if (!allowBootstrap(clientIp(req))) {
          sendJson(res, 429, { error: "rate limited" });
          return;
        }
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      sendJson(res, 200, mintSession(accountId));
      return;
    }

    if (method === "GET" && url.pathname === "/accounts/bootstrap") {
      const accountId = authenticate(req, store);
      if (accountId === null) {
        // Only a failure spends the login budget (threat H2).
        if (!allowBootstrap(clientIp(req))) {
          sendJson(res, 429, { error: "rate limited" });
          return;
        }
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      // wrap(MK, KEK) for the joining device, and a session, so it never
      // logs in twice.
      const account = store.getAccount(accountId);
      if (account === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        wrappedMasterKey: bytesToBase64(account.wrappedMasterKey),
        // Absent on older accounts.
        ...(account.wrappedRecoveryKey === undefined
          ? {}
          : {
              wrappedRecoveryKey: bytesToBase64(account.wrappedRecoveryKey),
            }),
        ...mintSession(accountId),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/accounts/recovery") {
      if (throttledRecovery(req, res)) return;
      // wrap(MK, recoveryKey), for a device that lost its password.
      const accountId = authenticateRecovery(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const account = store.getAccount(accountId);
      if (account?.wrappedMasterKeyRecovery === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        wrappedMasterKeyRecovery: bytesToBase64(
          account.wrappedMasterKeyRecovery,
        ),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/accounts/recovery") {
      // ⚠️ Password-authed, unlike the GET: a leaked phrase must not be able to
      // rotate itself. See the README's _Routes_.
      const accountId = authenticate(req, store);
      if (accountId === null) {
        // The same guessing surface, so the same budget (threat H2).
        if (!allowBootstrap(clientIp(req))) {
          sendJson(res, 429, { error: "rate limited" });
          return;
        }
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const parsed = rotateRecoveryBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      const { wrappedRecoveryKey, wrappedMasterKeyRecovery, recoveryVerifier } =
        parsed.data;
      store.setRecovery(
        accountId,
        base64ToBytes(wrappedRecoveryKey),
        base64ToBytes(wrappedMasterKeyRecovery),
        sha256(base64ToBytes(recoveryVerifier)),
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/accounts/reset") {
      if (throttledRecovery(req, res)) return;
      // Replaces the password door; the phrase keeps working.
      const accountId = authenticateRecovery(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const parsed = resetBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      const { authVerifier, kdfSalt, wrappedMasterKey } = parsed.data;
      store.setCredentials(
        accountId,
        sha256(base64ToBytes(authVerifier)),
        base64ToBytes(kdfSalt),
        base64ToBytes(wrappedMasterKey),
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/sync/push") {
      const accountId = authenticateSession(req);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const parsed = pushBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      // The authenticated account, never the body's.
      store.append(accountId, parsed.data.records.map(decodeRecord));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/sync/pull") {
      const accountId = authenticateSession(req);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const since = Number(url.searchParams.get("since") ?? "0");
      if (!Number.isFinite(since) || since < 0) {
        sendJson(res, 400, { error: "invalid cursor" });
        return;
      }
      const { records, cursor } = store.pull(accountId, since);
      sendJson(res, 200, { records: records.map(encodeRecord), cursor });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }
}
