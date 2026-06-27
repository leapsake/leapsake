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
 * `RELAY_RECOVERY_RATE_LIMIT_WINDOW_MS`. All defaults + env-var names live in
 * `./config`.
 *
 * Behind a reverse proxy, set `RELAY_TRUSTED_PROXIES` (comma-separated IPs / CIDR
 * ranges / `proxy-addr` presets like `loopback`, `uniquelocal`) so the rate
 * limiters key on the real client IP from `X-Forwarded-For`; unset trusts no
 * proxy and ignores the header (the secure default).
 *
 * Still deferred (see plans/encryption/security-review.md): TLS termination,
 * replay defense, device-scoped tokens, and a shared cross-process rate-limit
 * counter for multi-node relays (the single-node proxy-aware client IP is done).
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

// Comma-separated trusted proxies → string[] (empty when unset; trims blanks).
const trustedProxies = (process.env[ENV.trustedProxies] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

const store = createRelayStore(new DatabaseSync(dbPath));
createRelayServer({ store, rateLimit, recoveryRateLimit, trustedProxies }).listen(
  port,
  () => {
    console.log(`Leapsake relay listening on http://localhost:${port}`);
  },
);
