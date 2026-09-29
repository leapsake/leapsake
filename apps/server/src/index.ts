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

// The relay's runnable entry, configured by the env vars in `./config`; see
// the README's _Configuration_.
const port = Number(process.env[ENV.port] ?? DEFAULT_PORT);
const dbPath = process.env[ENV.dbPath] ?? DEFAULT_DB_PATH;

/** A `MAX` and `WINDOW_MS` env pair as a RateLimit, or undefined. */
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

// Comma-separated trusted proxies, empty when unset.
const trustedProxies = (process.env[ENV.trustedProxies] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

// Session-token lifetime; undefined takes the relay's default.
const sessionTtlEnv = process.env[ENV.sessionTtlMs];
const sessionTtlMs =
  sessionTtlEnv === undefined ? undefined : Number(sessionTtlEnv);

const maxBodyEnv = process.env[ENV.maxBodyBytes];
const maxBodyBytes = maxBodyEnv === undefined ? undefined : Number(maxBodyEnv);

// In-process TLS (Option B): the cert and key paths, both or neither.
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

// A production run with neither TLS nor a trusted proxy is taken to be on raw
// HTTP, and warns loudly.
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
  maxBodyBytes,
  tls,
}).listen(port, () => {
  const scheme = tls === undefined ? "http" : "https";
  console.log(`Leapsake relay listening on ${scheme}://localhost:${port}`);
});
