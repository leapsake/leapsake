// A minimal App Store Connect client: the transport, not the policy. See
// `scripts/release/README.md`.
import { createPrivateKey, sign as signPayload } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://api.appstoreconnect.apple.com";

// Apple's maximum token lifetime, renewed a minute early.
const TOKEN_TTL_S = 20 * 60;
const TOKEN_RENEW_MARGIN_S = 60;

// Retries, as a lost distribute costs a fresh archive and upload.
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 4_000, 10_000];
// The longest `Retry-After` honoured, so a stray value can't park a release.
const MAX_RETRY_AFTER_MS = 60_000;

/** A failed request, with Apple's own errors verbatim, and `code` and
 *  `status` for callers that tolerate some. */
export class AppleAppStoreConnectError extends Error {
  constructor(message, { status, errors = [], retryAfterMs }) {
    super(message);
    this.name = "AppleAppStoreConnectError";
    this.status = status;
    this.errors = errors;
    this.codes = errors.map((error) => error.code).filter(Boolean);
    // Set only on a 429 with a usable `Retry-After`.
    this.retryAfterMs = retryAfterMs;
  }

  /** Whether any of Apple's error codes matches. */
  hasCode(...codes) {
    return this.codes.some((code) => codes.includes(code));
  }
}

const base64url = (input) => Buffer.from(input).toString("base64url");

/** The client, from the same three variables `altool` uses. */
export function appleAppStoreConnectFromEnv() {
  return createAppleAppStoreConnect({
    keyId: process.env.APPLE_APP_STORE_CONNECT_KEY_ID.trim(),
    issuerId: process.env.APPLE_APP_STORE_CONNECT_ISSUER_ID.trim(),
    keyPath: resolve(process.env.APPLE_APP_STORE_CONNECT_KEY_PATH.trim()),
  });
}

export function createAppleAppStoreConnect({
  keyId,
  issuerId,
  keyPath,
  onRetry = warn,
}) {
  // Parsed now, so a bad `.p8` fails here, not twenty minutes into a poll.
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));

  let cached; // { jwt, expiresAt }

  /** A signed ES256 JWT, reused until nearly expired; unscoped. */
  function token() {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - TOKEN_RENEW_MARGIN_S > now)
      return cached.jwt;

    const header = { alg: "ES256", kid: keyId, typ: "JWT" };
    const expiresAt = now + TOKEN_TTL_S;
    const payload = {
      iss: issuerId,
      iat: now,
      exp: expiresAt,
      aud: "appstoreconnect-v1",
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
      JSON.stringify(payload),
    )}`;
    // ⚠️ JWS wants raw R‖S; Node's default DER reads to Apple as a wrong key.
    const signature = signPayload("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    cached = {
      jwt: `${signingInput}.${signature.toString("base64url")}`,
      expiresAt,
    };
    return cached.jwt;
  }

  /** One HTTP call; `request` does the retrying. */
  async function attempt(method, path, url, body) {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      // A `body` key is invalid on a GET, even when undefined.
      ...(body ? { body: JSON.stringify(body) } : {}),
      // The per-call ceiling, so a hung request can't stall a release.
      signal: AbortSignal.timeout(60_000),
    });

    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const errors = parsed?.errors ?? [];
      const detail = errors.length
        ? errors
            .map((error) =>
              [error.title, error.detail].filter(Boolean).join(": "),
            )
            .join("; ")
        : text.slice(0, 500) || response.statusText;
      throw new AppleAppStoreConnectError(
        `App Store Connect ${method} ${path} → ${response.status}: ${detail}`,
        {
          status: response.status,
          errors,
          retryAfterMs: retryAfterOf(response),
        },
      );
    }
    return parsed;
  }

  /**
   * One API call: its parsed body, `undefined` for a 204, else a throw.
   * ⚠️ Writes are retried too, so each must be idempotent; see the README.
   */
  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, BASE);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const one of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, String(one));
      }
    }

    for (let attemptNo = 1; ; attemptNo++) {
      try {
        return await attempt(method, path, url, body);
      } catch (error) {
        const delay = retryDelay(error, attemptNo);
        if (delay === undefined) throw error;
        onRetry(
          `App Store Connect ${method} ${path} — ${reason(error)}; retrying in ` +
            `${Math.round(delay / 1000)}s (attempt ${attemptNo + 1} of ${MAX_ATTEMPTS})`,
        );
        await sleep(delay);
      }
    }
  }

  return {
    token,
    request,
    get: (path, options) => request("GET", path, options),
    post: (path, options) => request("POST", path, options),
    patch: (path, options) => request("PATCH", path, options),
  };
}

/** How long to wait before retrying a transport failure, a 429 or a 5xx;
 *  `undefined` for anything else, a verdict. */
function retryDelay(error, attemptNo) {
  if (attemptNo >= MAX_ATTEMPTS) return undefined;
  const backoff = BACKOFF_MS[attemptNo - 1];

  if (error instanceof AppleAppStoreConnectError) {
    if (error.status === 429) return error.retryAfterMs ?? backoff;
    return error.status >= 500 ? backoff : undefined;
  }
  // A timeout, or undici's `TypeError` for any connection failure.
  const transport =
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError;
  return transport ? backoff : undefined;
}

/** `Retry-After` in ms, from seconds or a date, capped; nonsense ignored. */
function retryAfterOf(response) {
  const header = response.headers?.get?.("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/** The failure's name in a retry notice: Apple's words, or the transport's. */
function reason(error) {
  if (error instanceof AppleAppStoreConnectError) return `HTTP ${error.status}`;
  return error?.name === "TimeoutError" || error?.name === "AbortError"
    ? "timed out"
    : (error?.message ?? "request failed");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The default retry notice, to stderr, so a pause is not read as a hang. */
const warn = (message) => console.warn(`   ${message}`);

/** Parses JSON, surviving the HTML Apple's edge sometimes sends. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
