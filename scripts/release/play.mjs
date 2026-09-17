// A minimal Google Play Developer API client: authenticate, open an edit, upload a
// bundle, update tracks, commit.
//
// Transport only. Which track a rung ships to, and whether a release is held for manual
// publishing, live in `targets/android.mjs`.
import { createPrivateKey, sign as signPayload } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://androidpublisher.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

// Google rejects an assertion whose lifetime exceeds an hour. The access token it returns
// is re-minted a minute before it lapses.
const ASSERTION_TTL_S = 60 * 60;
const TOKEN_RENEW_MARGIN_S = 60;

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 4_000, 10_000];
const MAX_RETRY_AFTER_MS = 60_000;

const CALL_TIMEOUT_MS = 60_000;
// An AAB is tens of megabytes and Google's own guidance is a two-minute floor.
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** A failed Play API request, carrying Google's own `error` object. */
export class PlayError extends Error {
  constructor(message, { status, error, retryAfterMs }) {
    super(message);
    this.name = "PlayError";
    this.status = status;
    this.error = error;
    this.reasons = (error?.errors ?? [])
      .map((one) => one.reason)
      .filter(Boolean);
    this.retryAfterMs = retryAfterMs;
  }

  /** Whether any of Google's `errors[].reason` values matches. */
  hasReason(...wanted) {
    return this.reasons.some((one) => wanted.includes(one));
  }
}

const base64url = (input) => Buffer.from(input).toString("base64url");

/** The application route every edit path hangs off. */
const app = (packageName) =>
  `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;

/** Build the client from the service-account JSON named by `PLAY_SERVICE_ACCOUNT_PATH`. */
export function playFromEnv() {
  return createPlay({
    credentialsPath: resolve(process.env.PLAY_SERVICE_ACCOUNT_PATH.trim()),
  });
}

export function createPlay({ credentialsPath, onRetry = warn }) {
  // Parse at construction: a malformed key should fail here, not mid-upload.
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  for (const field of ["client_email", "private_key"]) {
    if (!credentials[field]) {
      throw new Error(
        `${credentialsPath} is missing "${field}" — is it a service-account key?`,
      );
    }
  }
  const privateKey = createPrivateKey(credentials.private_key);

  let cached; // { accessToken, expiresAt }

  /** A signed RS256 assertion, exchanged for an OAuth access token. */
  function assertion() {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "RS256",
      typ: "JWT",
      ...(credentials.private_key_id
        ? { kid: credentials.private_key_id }
        : {}),
    };
    const payload = {
      iss: credentials.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + ASSERTION_TTL_S,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
      JSON.stringify(payload),
    )}`;
    const signature = signPayload(
      "sha256",
      Buffer.from(signingInput),
      privateKey,
    );
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  /** The bearer token, minted on demand and reused until nearly expired. */
  async function token() {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - TOKEN_RENEW_MARGIN_S > now)
      return cached.accessToken;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion(),
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!response.ok || !parsed?.access_token) {
      // The token endpoint answers with `error`/`error_description`, not the API's shape.
      const detail =
        [parsed?.error, parsed?.error_description].filter(Boolean).join(": ") ||
        text.slice(0, 500) ||
        response.statusText;
      throw new PlayError(
        `Play token exchange → ${response.status}: ${detail}`,
        {
          status: response.status,
          error: parsed,
        },
      );
    }

    cached = {
      accessToken: parsed.access_token,
      expiresAt: now + Number(parsed.expires_in ?? 3600),
    };
    return cached.accessToken;
  }

  /** One HTTP call, with no opinion about retrying. */
  async function attempt(method, path, url, { body, binary, timeoutMs }) {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(binary ? { "content-type": "application/octet-stream" } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(binary ? { body: binary } : {}),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const error = parsed?.error;
      const detail =
        error?.message || text.slice(0, 500) || response.statusText;
      throw new PlayError(
        `Play ${method} ${path} → ${response.status}: ${detail}`,
        {
          status: response.status,
          error,
          retryAfterMs: retryAfterOf(response),
        },
      );
    }
    return parsed;
  }

  /**
   * One API call. `path` is a route; `query` values are strings or arrays.
   *
   * Retries transport failures and 429/5xx. `retry: false` opts out for a call whose
   * repeat is not harmless — the bundle upload, whose recovery is a fresh edit.
   */
  async function request(method, path, options = {}) {
    const { query, body, binary, retry = true, timeoutMs } = options;
    // The upload host is a prefix on the path, not a different base: `new URL` would
    // discard a base path against an absolute route.
    const url = new URL(binary ? `/upload${path}` : path, BASE);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const one of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, String(one));
      }
    }
    const call = {
      body,
      binary,
      timeoutMs: timeoutMs ?? (binary ? UPLOAD_TIMEOUT_MS : CALL_TIMEOUT_MS),
    };

    for (let attemptNo = 1; ; attemptNo++) {
      try {
        return await attempt(method, path, url, call);
      } catch (error) {
        const delay = retry ? retryDelay(error, attemptNo) : undefined;
        if (delay === undefined) throw error;
        onRetry(
          `Play ${method} ${path} — ${reason(error)}; retrying in ` +
            `${Math.round(delay / 1000)}s (attempt ${attemptNo + 1} of ${MAX_ATTEMPTS})`,
        );
        await sleep(delay);
      }
    }
  }

  const get = (path, options) => request("GET", path, options);
  const post = (path, options) => request("POST", path, options);
  const put = (path, options) => request("PUT", path, options);
  const del = (path, options) => request("DELETE", path, options);

  /** Upload an AAB into an open edit. Returns Google's `Bundle` (`versionCode`, hashes). */
  async function uploadBundle(packageName, editId, aabPath) {
    return post(`${app(packageName)}/edits/${editId}/bundles`, {
      query: { uploadType: "media" },
      binary: readFileSync(aabPath),
      retry: false,
    });
  }

  /**
   * Run `body` inside an edit: commit it on success, abandon it on failure.
   *
   * Nothing an edit contains takes effect until the commit, so an abandoned edit costs
   * nothing and burns no version code. `commit: false` always abandons, which is what a
   * dry run wants — it proves the upload works without spending anything.
   */
  async function withEdit(packageName, body, { commit = true, query } = {}) {
    const edit = await post(`${app(packageName)}/edits`);
    const abandon = async () => {
      try {
        await del(`${app(packageName)}/edits/${edit.id}`);
      } catch (error) {
        // An edit expires on its own; losing the tidy-up must not mask the real failure.
        onRetry(`Play edit ${edit.id} was left open — ${reason(error)}`);
      }
    };

    let result;
    try {
      result = await body(edit.id);
    } catch (error) {
      await abandon();
      throw error;
    }

    if (!commit) {
      await abandon();
      return result;
    }
    await post(`${app(packageName)}/edits/${edit.id}:commit`, { query });
    return result;
  }

  return {
    token,
    request,
    get,
    post,
    put,
    delete: del,
    app,
    uploadBundle,
    withEdit,
  };
}

/**
 * How long to wait before trying again, or `undefined` for "do not".
 *
 * Transport failures never reached Google's opinion, and 429/5xx is Google asking for
 * later. Every other status is a verdict.
 */
function retryDelay(error, attemptNo) {
  if (attemptNo >= MAX_ATTEMPTS) return undefined;
  const backoff = BACKOFF_MS[attemptNo - 1];

  if (error instanceof PlayError) {
    if (error.status === 429) return error.retryAfterMs ?? backoff;
    return error.status >= 500 ? backoff : undefined;
  }
  const transport =
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError;
  return transport ? backoff : undefined;
}

/** `Retry-After` in milliseconds — seconds or an HTTP date, capped, ignored if nonsense. */
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

/** What to call this failure in the retry notice. */
function reason(error) {
  if (error instanceof PlayError) return `HTTP ${error.status}`;
  return error?.name === "TimeoutError" || error?.name === "AbortError"
    ? "timed out"
    : (error?.message ?? "request failed");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The default retry notice, indented to match the progress lines in `targets/`. */
const warn = (message) => console.warn(`   ${message}`);

/** Google has been known to answer with HTML from an edge layer; do not die on it. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
