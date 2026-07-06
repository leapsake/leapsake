import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_DB_PATH,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  ENV,
  type RateLimit,
} from "./config.js";
import { createRelayServer } from "./relay.js";
import { createRelayStore } from "./store.js";

/**
 * Runnable entry for the blind relay (plans/encryption/sync.md §2). Defaults are
 * dev-friendly; override with `PORT` and `RELAY_DB` (a file path, or `:memory:`),
 * and tune the unauthenticated-endpoint throttle with `RELAY_RATE_LIMIT_MAX` /
 * `RELAY_RATE_LIMIT_WINDOW_MS` (the enumeration mitigation, security-review.md §3).
 * The recovery-authed endpoints (`/accounts/recovery`, `/accounts/reset`) have
 * their own tighter throttle, tuned with `RELAY_RECOVERY_RATE_LIMIT_MAX` /
 * `RELAY_RECOVERY_RATE_LIMIT_WINDOW_MS`, and failed logins at `/accounts/bootstrap`
 * are throttled via `RELAY_BOOTSTRAP_RATE_LIMIT_MAX` /
 * `RELAY_BOOTSTRAP_RATE_LIMIT_WINDOW_MS` (the online-guessing mitigation,
 * security-findings.md H2). All defaults + env-var names live in `./config`.
 *
 * Behind a reverse proxy, set `RELAY_TRUSTED_PROXIES` (comma-separated IPs / CIDR
 * ranges / `proxy-addr` presets like `loopback`, `uniquelocal`) so the rate
 * limiters key on the real client IP from `X-Forwarded-For`; unset trusts no
 * proxy and ignores the header (the secure default). Short-lived login sessions
 * (security-findings.md H3) carry the hot sync path; tune their lifetime with
 * `RELAY_SESSION_TTL_MS`.
 *
 * TLS: terminate it **in front** (Option A — a proxy; the default) or **in-process**
 * (Option B) by setting `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (PEM file paths; plus
 * `RELAY_TLS_KEY_PASSPHRASE` for an encrypted key). See apps/server/README.md → Deploy.
 *
 * Still deferred (see plans/encryption/security-review.md): replay defense and a
 * shared cross-process session + rate-limit store for multi-node relays (the
 * single-node proxy-aware client IP is done).
 */
const port = Number(process.env[ENV.port] ?? DEFAULT_PORT);
const dbPath = process.env[ENV.dbPath] ?? DEFAULT_DB_PATH;

/** Parse a `MAX` / `WINDOW_MS` env pair into a RateLimit (undefined → built-in default). */
function rateLimitFromEnv(
  max: string | undefined,
  windowMs: string | undefined,
): RateLimit | undefined {
  return max === undefined
    ? undefined
    : {
        max: Number(max),
        windowMs: Number(windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
      };
}

const rateLimit = rateLimitFromEnv(
  process.env[ENV.rateLimitMax],
  process.env[ENV.rateLimitWindowMs],
);
const recoveryRateLimit = rateLimitFromEnv(
  process.env[ENV.recoveryRateLimitMax],
  process.env[ENV.recoveryRateLimitWindowMs],
);
const bootstrapRateLimit = rateLimitFromEnv(
  process.env[ENV.bootstrapRateLimitMax],
  process.env[ENV.bootstrapRateLimitWindowMs],
);

// Comma-separated trusted proxies → string[] (empty when unset; trims blanks).
const trustedProxies = (process.env[ENV.trustedProxies] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

// Session-token lifetime (undefined → built-in default in createRelayServer).
const sessionTtlEnv = process.env[ENV.sessionTtlMs];
const sessionTtlMs =
  sessionTtlEnv === undefined ? undefined : Number(sessionTtlEnv);

// In-process TLS (Option B): set BOTH the cert and key paths, or neither. Both ⇒ the
// relay speaks HTTPS itself; neither ⇒ plain HTTP (terminate TLS in front, Option A).
const tlsCertPath = process.env[ENV.tlsCert];
const tlsKeyPath = process.env[ENV.tlsKey];
if ((tlsCertPath === undefined) !== (tlsKeyPath === undefined)) {
  throw new Error(
    `In-process TLS needs both ${ENV.tlsCert} and ${ENV.tlsKey} (or neither).`,
  );
}
const tls =
  tlsCertPath === undefined || tlsKeyPath === undefined
    ? undefined
    : {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
        passphrase: process.env[ENV.tlsKeyPassphrase],
      };

// The relay must sit behind TLS — terminated in front (Option A) or in-process
// (Option B, `tls` above). It can't detect a front proxy except via a configured
// trusted-proxy set, so a production run with neither TLS nor a trusted proxy is
// assumed to be exposed on raw HTTP, and we warn loudly (the H3 deploy gate: never
// serve the relay on plain HTTP anywhere real). Dev runs (NODE_ENV unset) and any
// TLS/proxy config stay quiet. See apps/server/README.md → Deploy.
if (
  process.env.NODE_ENV === "production" &&
  trustedProxies.length === 0 &&
  tls === undefined
) {
  console.warn(
    "⚠  Leapsake relay: serving plain HTTP with no TLS and no trusted proxy. Put a " +
      "TLS-terminating proxy (e.g. Caddy) in front and set RELAY_TRUSTED_PROXIES, or " +
      "enable in-process TLS with RELAY_TLS_CERT + RELAY_TLS_KEY — never expose the " +
      "relay on plain HTTP. See apps/server/README.md → Deploy.",
  );
}

const store = createRelayStore(new DatabaseSync(dbPath));
createRelayServer({
  store,
  rateLimit,
  recoveryRateLimit,
  bootstrapRateLimit,
  trustedProxies,
  sessionTtlMs,
  tls,
}).listen(port, () => {
  const scheme = tls === undefined ? "http" : "https";
  console.log(`Leapsake relay listening on ${scheme}://localhost:${port}`);
});
