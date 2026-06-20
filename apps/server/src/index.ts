import { DatabaseSync } from "node:sqlite";
import { createRelayServer } from "./relay.js";
import { createRelayStore } from "./store.js";

/**
 * Runnable entry for the blind relay (plans/encryption/sync.md §2). Defaults are
 * dev-friendly; override with `PORT` and `RELAY_DB` (a file path, or `:memory:`),
 * and tune the unauthenticated-endpoint throttle with `RELAY_RATE_LIMIT_MAX` /
 * `RELAY_RATE_LIMIT_WINDOW_MS` (the enumeration mitigation, security-review.md §3).
 *
 * Still deferred (see plans/encryption/security-review.md): TLS termination,
 * replay defense, device-scoped tokens, and proxy-aware client-IP handling.
 */
const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.RELAY_DB ?? "relay.db";

const rateLimitMax = process.env.RELAY_RATE_LIMIT_MAX;
const rateLimitWindowMs = process.env.RELAY_RATE_LIMIT_WINDOW_MS;
const rateLimit =
  rateLimitMax !== undefined
    ? {
        max: Number(rateLimitMax),
        windowMs: Number(rateLimitWindowMs ?? 60_000),
      }
    : undefined;

const store = createRelayStore(new DatabaseSync(dbPath));
createRelayServer({ store, rateLimit }).listen(port, () => {
  console.log(`Leapsake relay listening on http://localhost:${port}`);
});
