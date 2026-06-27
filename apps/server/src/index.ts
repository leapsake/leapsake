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
 * Still deferred (see plans/encryption/security-review.md): TLS termination,
 * replay defense, device-scoped tokens, and proxy-aware client-IP handling.
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

const store = createRelayStore(new DatabaseSync(dbPath));
createRelayServer({ store, rateLimit, recoveryRateLimit }).listen(port, () => {
  console.log(`Leapsake relay listening on http://localhost:${port}`);
});
