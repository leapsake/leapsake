import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { base64ToBytes, bytesToBase64 } from "@leapsake/crypto";
import { decodeRecord, encodeRecord } from "@leapsake/data";
import { z } from "zod";
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_RECOVERY_RATE_LIMIT,
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
 * - `GET  /accounts/bootstrap` — auth required; → `{ wrappedMasterKey }` for a joining device.
 * - `POST /sync/push`          — auth required; append `{ records }` to the account log.
 * - `GET  /sync/pull`          — auth required; `?since=<cursor>` → `{ records, cursor }`.
 *
 * Auth is `Authorization: Bearer <accountId>.<base64(authVerifier)>`. The relay
 * stores only `sha256(verifier)` and constant-time-compares (model.md §9.3); a
 * device may only ever touch its own namespace, taken from the authenticated
 * identity — never from the request body.
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
 * A minimal fixed-window, per-IP rate limiter. Two instances guard the relay (see
 * {@link createRelayServer}): one on the **unauthenticated** enumeration vectors
 * (`GET /accounts/lookup`, `POST /accounts`) and a stricter one on the
 * recovery-authed endpoints. The launch join scheme is username + password
 * (multi-device-login.md), so a username existence oracle is an *accepted,
 * deliberate* property — it can't be removed without dropping usernames — but it
 * **can be throttled**, the pragmatic enumeration mitigation (security-review.md
 * §3). The authenticated routes (`bootstrap`/`push`/`pull`) aren't enumeration
 * oracles, so they aren't throttled.
 *
 * In-memory and per-process: right for a single-node relay. A multi-node or
 * reverse-proxied deployment needs a shared counter and `X-Forwarded-For`
 * awareness (the client IP is otherwise the proxy's) — named follow-ups in the
 * security review. Default parameters live in {@link ./config}.
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
}): Server {
  const { store } = opts;
  const allow = createRateLimiter(opts.rateLimit ?? DEFAULT_RATE_LIMIT);
  // A separate counter so recovery-flood throttling never spends (or is spent by)
  // the enumeration budget — the two surfaces are independent.
  const allowRecovery = createRateLimiter(
    opts.recoveryRateLimit ?? DEFAULT_RECOVERY_RATE_LIMIT,
  );

  /** Throttle a request by client IP; answers 429 and returns true if over. */
  function throttled(req: IncomingMessage, res: ServerResponse): boolean {
    if (allow(req.socket.remoteAddress ?? "unknown")) return false;
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
    if (allowRecovery(req.socket.remoteAddress ?? "unknown")) return false;
    sendJson(res, 429, { error: "rate limited" });
    return true;
  }

  return createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    });
  });

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
        wrappedMasterKeyRecovery,
        recoveryVerifier,
      } = parsed.data;
      const result = store.registerAccount(
        accountId,
        username.trim().toLowerCase(),
        sha256(base64ToBytes(authVerifier)),
        base64ToBytes(kdfSalt),
        base64ToBytes(wrappedMasterKey),
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

    if (method === "GET" && url.pathname === "/accounts/bootstrap") {
      const accountId = authenticate(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      // Authenticated: hand back this account's opaque wrap(MK, KEK) so the
      // joining device can unwrap the master key locally. The relay never reads it.
      const account = store.getAccount(accountId);
      if (account === undefined) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        wrappedMasterKey: bytesToBase64(account.wrappedMasterKey),
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
      const accountId = authenticate(req, store);
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
      const accountId = authenticate(req, store);
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
