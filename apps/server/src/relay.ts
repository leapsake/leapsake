import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { base64ToBytes, bytesToBase64 } from "@leapsake/crypto";
import { decodeRecord, encodeRecord } from "@leapsake/data";
import proxyaddr from "proxy-addr";
import { z } from "zod";
import {
  DEFAULT_BOOTSTRAP_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RECOVERY_RATE_LIMIT,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_TRUSTED_PROXIES,
  ENV,
  type RateLimit,
} from "./config.js";
import type { RelayStore } from "./store.js";

// `RateLimit` is part of the public `createRelayServer` options surface; re-export
// it from here so existing importers keep their path while the value lives in config.
export type { RateLimit };

/**
 * The blind relay — `sync.md` §2's "least clever option": an authenticated
 * HTTPS endpoint that stores and serves opaque {@link WireRecord}s ordered by an
 * opaque cursor. It can read, merge, and order *nothing* about content; it only
 * orders *delivery*. Three routes:
 *
 * - `POST /accounts`           — register `{ accountId, username, authVerifier,
 *                                kdfSalt, wrappedMasterKey }` (b64); dup username → 409.
 * - `GET  /accounts/lookup`    — unauthed prelogin; `?username=` → `{ accountId, kdfSalt }`.
 * - `POST /accounts/session`   — verifier auth; mints a short-lived session token.
 * - `GET  /accounts/bootstrap` — verifier auth; → `{ wrappedMasterKey,
 *                                wrappedRecoveryKey?, token, expiresAt }` for a joining
 *                                device (the wrapped MK, the recovery-key escrow, *and* a session).
 * - `POST /sync/push`          — session auth; append `{ records }` to the account log.
 * - `GET  /sync/pull`          — session auth; `?since=<cursor>` → `{ records, cursor }`.
 *
 * **Two credentials, one durable and one short-lived (security-findings.md H3).**
 * The durable one is the password-derived **verifier**, sent as
 * `Authorization: Bearer <accountId>.<base64(authVerifier)>`; the relay stores only
 * `sha256(verifier)` and constant-time-compares (model.md §9.3). It authenticates the
 * two login endpoints (`/accounts/session`, `/accounts/bootstrap`) — *once per login*,
 * not per request. Each mints a random **session token**, presented on the hot
 * `push`/`pull` path as `Authorization: Session <token>`. That shrinks raw-verifier
 * observation from "every request, forever" to "once per login", the v0.1 half of the
 * H1 mitigation (the other half is TLS; OPAQUE closes it fully at the hosted-relay gate,
 * sync.md §4). Sessions are held **in-memory, per-process** — ephemeral, non-user-data:
 * a relay restart just costs each device one silent re-login, and (like the rate
 * limiters) a multi-node relay still needs a shared session store, the same follow-up as
 * the shared rate-limit counter (security-review.md §3). Either way a device may only
 * ever touch its own namespace, taken from the authenticated identity — never the body.
 *
 * Account creation reserves an env-gated **registration-token** seam: access
 * control (who may store bytes) is orthogonal to zero-knowledge (who may read
 * them). If `RELAY_REGISTRATION_TOKEN` is set the relay requires + constant-time-
 * compares it on `POST /accounts`; unset ⇒ the relay is public (the default).
 * This is the host-auth / paid-relay hook — additive, never a one-way door
 * (multi-device-login.md).
 *
 * The two **unauthenticated** routes (`POST /accounts`, `GET /accounts/lookup`)
 * are per-IP **rate-limited** ({@link RateLimit}) — the pragmatic mitigation for
 * the username-existence oracle that the username/password join scheme inherently
 * exposes (security-review.md §3).
 */

// --- Trust-boundary validation (AGENTS.md: Zod at every boundary). ----------

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "expected base64");

const registerBodySchema = z.object({
  accountId: z.uuid(),
  username: z.string().min(1),
  authVerifier: base64,
  kdfSalt: base64,
  wrappedMasterKey: base64,
  // Inverse escrow wrap(recoveryKey, MK) — lets a password-joining device reveal
  // the account phrase. Optional, matching wrappedMasterKeyRecovery.
  wrappedRecoveryKey: base64.optional(),
  // Recovery escrow (model.md §6). Optional so a pre-recovery client can still
  // register; current clients always send both.
  wrappedMasterKeyRecovery: base64.optional(),
  recoveryVerifier: base64.optional(),
});

/** Recovery-authenticated password reset: new password-door material. */
const resetBodySchema = z.object({
  authVerifier: base64,
  kdfSalt: base64,
  wrappedMasterKey: base64,
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

// --- Helpers. ---------------------------------------------------------------

function sha256(input: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(input).digest());
}

/**
 * The registration-token gate on `POST /accounts`. If `RELAY_REGISTRATION_TOKEN`
 * is unset the relay is public (returns true). If set, the request must carry the
 * matching token in `X-Registration-Token`, compared in constant time. This is
 * the host-auth / paid-relay seam — content-blind, orthogonal to zero-knowledge.
 */
function registrationTokenOk(req: IncomingMessage): boolean {
  const expected = process.env[ENV.registrationToken];
  if (expected === undefined || expected === "") return true;
  const presented = req.headers["x-registration-token"];
  if (typeof presented !== "string") return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A minimal fixed-window, per-IP rate limiter. Three instances guard the relay (see
 * {@link createRelayServer}): one on the **unauthenticated** enumeration vectors
 * (`GET /accounts/lookup`, `POST /accounts`), a stricter one on the recovery-authed
 * endpoints, and a third on **failed** authentications at the two verifier-checking
 * login endpoints (`GET /accounts/bootstrap`, `POST /accounts/session`).
 * The launch join scheme is username + password (multi-device-login.md), so a username
 * existence oracle is an *accepted, deliberate* property — it can't be removed without
 * dropping usernames — but it **can be throttled**, the pragmatic enumeration mitigation
 * (security-review.md §3). Those two logins aren't enumeration oracles but *are* password
 * oracles — a successful auth returns `wrap(MK, KEK)` or a session token — so an online
 * guessing grind is capped across both, sharing one budget (security-findings.md H2/H3).
 * `push`/`pull` stay un-throttled: neither oracle, and hit legitimately on every sync.
 *
 * The key is a proxy-aware client IP (see {@link createRelayServer}'s `clientIp`):
 * behind a trusted reverse proxy it's the real client from `X-Forwarded-For`, not
 * the proxy's address. In-memory and per-process, so right for a *single-node*
 * relay; a multi-node deployment still needs a shared counter (the remaining
 * security-review.md §3 follow-up). Default parameters live in {@link ./config}.
 */
function createRateLimiter(limit: RateLimit): (ip: string) => boolean {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function allow(ip: string): boolean {
    const now = Date.now();
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

/**
 * Authenticate the bearer token against the relay's stored verifier hash.
 * Returns the authenticated account id, or `null` on any failure (no account,
 * malformed token, verifier mismatch) — the caller answers 401 either way.
 */
function authenticate(req: IncomingMessage, store: RelayStore): string | null {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);

  // Split on the first `.`: the account UUID has none, and base64 produces none.
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

/**
 * Authenticate a **recovery** request: the `Authorization: Recovery
 * <accountId>.<base64(recoveryVerifier)>` scheme, checked against the stored
 * recovery-verifier hash (the recovery sibling of {@link authenticate}). A
 * distinct scheme so the password and recovery doors never cross-authenticate.
 * Returns the account id or `null` (no account, no recovery escrow, mismatch).
 */
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

// --- The server. ------------------------------------------------------------

export function createRelayServer(opts: {
  store: RelayStore;
  /** Per-IP throttle on the unauthenticated endpoints. Defaults generous. */
  rateLimit?: RateLimit;
  /**
   * Per-IP throttle on the recovery-authed endpoints (`/accounts/recovery`,
   * `/accounts/reset`). Defaults tighter than {@link rateLimit} — see
   * {@link DEFAULT_RECOVERY_RATE_LIMIT}.
   */
  recoveryRateLimit?: RateLimit;
  /**
   * Per-IP throttle on **failed** authentications at the verifier-checking login
   * endpoints (`GET /accounts/bootstrap`, `POST /accounts/session`), the online-
   * password-guessing mitigation (security-findings.md H2/H3). Its own shared counter,
   * so a guessing grind never spends — nor is laundered across — the enumeration/
   * recovery budgets. Defaults tight — see {@link DEFAULT_BOOTSTRAP_RATE_LIMIT}.
   */
  bootstrapRateLimit?: RateLimit;
  /**
   * Reverse proxies trusted to set `X-Forwarded-For`, so the rate limiters key on
   * the real client IP rather than the proxy's when the relay runs behind one.
   * Each entry is an IP, a CIDR range, or a `proxy-addr` preset (`loopback`,
   * `uniquelocal`, …). Empty (the default) trusts none and ignores the header —
   * the secure default; see {@link DEFAULT_TRUSTED_PROXIES}.
   */
  trustedProxies?: readonly string[];
  /**
   * Lifetime of a minted session token, in ms (default
   * {@link DEFAULT_SESSION_TTL_MS}). Short by design — see that constant.
   */
  sessionTtlMs?: number;
  /**
   * In-process TLS (Option B). When set, the relay terminates HTTPS itself with
   * this cert + key instead of speaking plain HTTP; when omitted, it speaks plain
   * HTTP and TLS is terminated in front of it (Option A, the default). The two are
   * orthogonal — a deployment may do both (public TLS at a proxy, re-encrypted to
   * the relay) when the proxy and relay sit on different hosts.
   */
  tls?: { cert: string | Buffer; key: string | Buffer; passphrase?: string };
}): Server {
  const { store } = opts;
  const allow = createRateLimiter(opts.rateLimit ?? DEFAULT_RATE_LIMIT);
  // A separate counter so recovery-flood throttling never spends (or is spent by)
  // the enumeration budget — the two surfaces are independent.
  const allowRecovery = createRateLimiter(
    opts.recoveryRateLimit ?? DEFAULT_RECOVERY_RATE_LIMIT,
  );
  // A third, independent counter for failed bootstrap auths (security-findings.md H2),
  // so an online password-guessing grind can't spend the enumeration/recovery budgets.
  const allowBootstrap = createRateLimiter(
    opts.bootstrapRateLimit ?? DEFAULT_BOOTSTRAP_RATE_LIMIT,
  );

  // Compile the trusted-proxy predicate once. proxy-addr walks `socket + XFF`
  // from the socket end, hops over each *trusted* address, and returns the first
  // untrusted one — the real client. An empty trust set never hops, so this just
  // returns `req.socket.remoteAddress` (today's behavior) and the spoofable XFF
  // is ignored.
  const trust = proxyaddr.compile([
    ...(opts.trustedProxies ?? DEFAULT_TRUSTED_PROXIES),
  ]);
  const clientIp = (req: IncomingMessage): string => proxyaddr(req, trust);

  /** Throttle a request by client IP; answers 429 and returns true if over. */
  function throttled(req: IncomingMessage, res: ServerResponse): boolean {
    if (allow(clientIp(req))) return false;
    sendJson(res, 429, { error: "rate limited" });
    return true;
  }

  /**
   * Throttle a recovery-authed request by client IP against the stricter
   * recovery budget; answers 429 and returns true if over. Call this *before*
   * {@link authenticateRecovery} so a wrong-verifier guesser is throttled (a
   * post-auth check would never see the rejected attempts it's meant to limit).
   */
  function throttledRecovery(
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    if (allowRecovery(clientIp(req))) return false;
    sendJson(res, 429, { error: "rate limited" });
    return true;
  }

  // In-memory session store: sha256(token) → the account it authenticates and its
  // expiry. Ephemeral and per-process by design (see the header doc); keyed by the
  // token *hash* so a memory dump never yields a usable bearer. The token itself is
  // 256-bit random — not password-derived — so a lookup miss leaks nothing and needs
  // no constant-time compare (unlike the verifier hashes).
  const sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessions = new Map<string, { accountId: string; expiresAt: number }>();

  /** Drop every expired session; called on each mint so the map stays bounded. */
  function purgeExpiredSessions(now: number): void {
    for (const [key, session] of sessions) {
      if (now >= session.expiresAt) sessions.delete(key);
    }
  }

  /** Mint a fresh session token for an authenticated account; returns the wire pair. */
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

  /**
   * Authenticate a `Authorization: Session <token>` request against a live session.
   * Returns the account id, or `null` on any failure (missing/malformed header,
   * unknown token, expired). The session sibling of {@link authenticate} — the hot
   * `push`/`pull` path uses this so the raw verifier never transits per-request.
   */
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

  // The request listener is identical over HTTP and HTTPS — TLS (Option B) is purely
  // a transport wrapper around the same handler, session store, and limiters.
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    });
  };

  // Option B serves HTTPS only — there is deliberately no HTTP→HTTPS redirect
  // listener: clients hold the relay's `https://` URL directly, and port-80
  // handling is a front-proxy (Option A) concern. If one were ever wanted, add a
  // second `createHttpServer` bound to :80 here whose handler 301s to the https
  // origin. (`https.Server` extends `http.Server`, so the return type is unchanged.)
  return opts.tls === undefined
    ? createHttpServer(listener)
    : createHttpsServer(opts.tls, listener);

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://relay");
    const { method } = req;

    if (method === "POST" && url.pathname === "/accounts") {
      if (throttled(req, res)) return;
      // Access-control seam (content-blind) — checked before anything is stored.
      if (!registrationTokenOk(req)) {
        sendJson(res, 401, { error: "registration token required" });
        return;
      }
      const parsed = registerBodySchema.safeParse(
        JSON.parse((await readBody(req)) || "{}"),
      );
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
      // Unauthed prelogin: a joining device knows only the username, and needs
      // the account id + public salt to derive its KEK and authenticate.
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
      // The steady-state login: verifier auth *once*, in exchange for a short-lived
      // session token that carries the hot `push`/`pull` path (security-findings.md H3).
      const accountId = authenticate(req, store);
      if (accountId === null) {
        // Failed auth here is the same online-guessing surface as bootstrap, so it
        // shares that budget (a wrong-verifier grind can't be laundered across the two).
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
        // A failed auth consumes the per-IP bootstrap budget; once exhausted we 429 so
        // a password-guessing grind is throttled (security-findings.md H2). A legit
        // device authenticates successfully and never touches this counter.
        if (!allowBootstrap(clientIp(req))) {
          sendJson(res, 429, { error: "rate limited" });
          return;
        }
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      // Authenticated: hand back this account's opaque wrap(MK, KEK) so the joining
      // device can unwrap the master key locally (the relay never reads it), plus a
      // session token so the same verifier auth that joined also seeds sync — the
      // joining device never has to log in a second time.
      const account = store.getAccount(accountId);
      if (account === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        wrappedMasterKey: bytesToBase64(account.wrappedMasterKey),
        // The inverse escrow so a joining device reveals the account phrase;
        // absent on pre-unification accounts.
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
      // Recovery-authed: hand back wrap(MK, recoveryKey) so a device that lost
      // its password can unwrap MK from the recovery phrase. Opaque to the relay.
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

    if (method === "POST" && url.pathname === "/accounts/reset") {
      if (throttledRecovery(req, res)) return;
      // Recovery-authed: replace the password door with new material so the
      // recovered device can authenticate going forward. The recovery escrow +
      // verifier are untouched, so the same phrase keeps working.
      const accountId = authenticateRecovery(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const parsed = resetBodySchema.safeParse(
        JSON.parse((await readBody(req)) || "{}"),
      );
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
      const parsed = pushBodySchema.safeParse(
        JSON.parse((await readBody(req)) || "{}"),
      );
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      // The account is the *authenticated* identity, never the body — a device
      // can only ever push into its own namespace.
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
