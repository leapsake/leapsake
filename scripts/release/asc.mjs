// A minimal App Store Connect REST client — enough to take a build from *uploaded* to
// *in beta review*, and nothing more.
//
// **Why this exists at all.** `altool` puts the `.ipa` in App Store Connect and stops.
// Everything that makes an uploaded build reach an external tester — waiting out
// processing, attaching "What to Test", adding the build to a group, submitting it for
// beta review — is only reachable over this API. Without it, `pnpm release beta` would end
// with a build sitting in App Store Connect and a human finishing the job in a browser,
// which is the one thing the release path is supposed to remove.
//
// **No dependency.** `node:crypto` signs the ES256 JWT on its own and `fetch` is built in,
// so this file adds nothing to `package.json` — in keeping with the rest of `scripts/`,
// which has no dependencies at all. The signature is the only part with a trap in it, and
// it is one line: JWS wants the raw `R‖S` pair, and Node emits DER unless told otherwise
// (`dsaEncoding: "ieee-p1363"`).
//
// **This file is the transport, not the policy.** It knows how to authenticate and how to
// turn a non-2xx into a readable error; it does not know what a release is, which rungs
// distribute externally, or how long a build may take to process. That lives in
// `targets/ios.mjs`, next to the rest of the iOS policy — so a second caller (macOS
// notarization history, a future App Store submission) reuses the client without
// inheriting TestFlight's decisions.
import { createPrivateKey, sign as signPayload } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://api.appstoreconnect.apple.com";

// Apple rejects a token whose lifetime exceeds 20 minutes. Requesting exactly that and
// renewing a minute early keeps a long poll (processing can take 20 minutes on its own)
// from failing on an expiry it could have avoided.
const TOKEN_TTL_S = 20 * 60;
const TOKEN_RENEW_MARGIN_S = 60;

/**
 * A failed App Store Connect request, carrying what Apple said about it.
 *
 * Apple's `errors[]` array is unusually informative — `detail` typically names the exact
 * attribute and why it was rejected — so it is worth surfacing verbatim rather than
 * reporting "HTTP 409". `code` and `status` are kept as fields because callers branch on
 * them: submitting a build that App Store Connect already submitted implicitly is an error
 * to *tolerate*, not to fail on, and the code is how it is recognized.
 */
export class AscError extends Error {
  constructor(message, { status, errors = [] }) {
    super(message);
    this.name = "AscError";
    this.status = status;
    this.errors = errors;
    this.codes = errors.map((error) => error.code).filter(Boolean);
  }

  /** Whether any of Apple's error codes matches — the tolerate-this-one predicate. */
  hasCode(...codes) {
    return this.codes.some((code) => codes.includes(code));
  }
}

const base64url = (input) => Buffer.from(input).toString("base64url");

/**
 * Build the client from the same three variables `altool` already uses.
 *
 * Deliberately not a fourth credential: the key that uploads is the key that distributes,
 * so there is one thing to rotate and one place a wrong role shows up. (The *role* is the
 * catch — see `ascSetup` in `targets/ios.mjs`.)
 */
export function ascFromEnv() {
  return createAsc({
    keyId: process.env.ASC_KEY_ID.trim(),
    issuerId: process.env.ASC_ISSUER_ID.trim(),
    keyPath: resolve(process.env.ASC_KEY_PATH.trim()),
  });
}

export function createAsc({ keyId, issuerId, keyPath }) {
  // Read and parse the key once, at construction: a malformed `.p8` should fail where the
  // client is created, not twenty minutes into a poll.
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));

  let cached; // { jwt, expiresAt }

  /**
   * A signed ES256 JWT, minted on demand and reused until it is nearly expired.
   *
   * `aud` is the fixed string Apple requires; `iss` is the issuer the key belongs to.
   * There is no `scope`, which would narrow the token to specific routes — this token is
   * used for a handful of related calls in one release and narrowing it would buy nothing
   * a wrongly-scoped key would not immediately break.
   */
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
    // `ieee-p1363` is the raw R‖S signature JWS specifies. Node's default is DER, which
    // Apple rejects as a malformed token — an authentication failure that looks like a
    // wrong key rather than a wrong encoding.
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

  /**
   * One API call. `path` is a route (`/v1/builds`); `query` is an object whose values are
   * strings or arrays, so Apple's `filter[...]`/`fields[...]` keys stay readable at the
   * call site.
   *
   * Returns the parsed body, or `undefined` for the 204s that relationship writes answer
   * with. Anything non-2xx throws an `AscError` carrying Apple's own explanation.
   */
  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, BASE);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const one of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, String(one));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      // Spread rather than `body: undefined`: a `body` key present on a GET is invalid
      // even when its value is undefined, and the linter is right to say so.
      ...(body ? { body: JSON.stringify(body) } : {}),
      // A hung request would otherwise stall a release indefinitely. The *poll* has its
      // own, much longer budget; this is the per-call ceiling.
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
      throw new AscError(
        `App Store Connect ${method} ${path} → ${response.status}: ${detail}`,
        { status: response.status, errors },
      );
    }
    return parsed;
  }

  return {
    token,
    request,
    get: (path, options) => request("GET", path, options),
    post: (path, options) => request("POST", path, options),
    patch: (path, options) => request("PATCH", path, options),
  };
}

/** Apple has been known to answer with HTML from an edge layer; do not die on it. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
