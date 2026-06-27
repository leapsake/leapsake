/**
 * The single registry of relay tunables: every value that a deployment might
 * one day want to override — sane built-in **defaults** plus the **env-var
 * names** they're read from — lives here, not scattered as literals across
 * `relay.ts` / `index.ts`.
 *
 * Today these are constants with a few env overrides wired up in `index.ts`. The
 * intent is to grow this file into the one place that owns env-var and (later)
 * user-customizable settings, so a new knob is added here once rather than as
 * another magic number somewhere in the request path.
 */

/** Per-IP, fixed-window throttle parameters. */
export interface RateLimit {
  /** Max requests allowed per client IP within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Default HTTP port for the runnable relay (`index.ts`). */
export const DEFAULT_PORT = 4000;

/** Default store path; `:memory:` is also accepted (`index.ts`, `RELAY_DB`). */
export const DEFAULT_DB_PATH = "relay.db";

/** Shared default window for both throttles. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * The default throttle on the **unauthenticated** enumeration vectors
 * (`GET /accounts/lookup`, `POST /accounts`) — generous; tune per deployment. The
 * username join scheme makes an existence oracle deliberate-but-throttled
 * (security-review.md §3); the authenticated routes aren't oracles, so aren't
 * throttled.
 */
export const DEFAULT_RATE_LIMIT: RateLimit = {
  max: 60,
  windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
};

/**
 * A tighter default throttle for the **recovery-authed** endpoints
 * (`GET /accounts/recovery`, `POST /accounts/reset`). These are a distinct,
 * higher-stakes surface from the enumeration oracle: `reset` is state-changing
 * (it rotates the password door) and both are gated only by the recovery
 * verifier, so they're the natural target for a verifier-guessing flood. The
 * verifier is 256-bit (brute force is already infeasible), so this throttle is
 * defense-in-depth + flood/DoS mitigation, not the primary guard — hence a far
 * lower cap than the enumeration limit, since a *legitimate* client touches
 * these endpoints only during the rare manual recovery (a handful of attempts at
 * most). Per-IP, like {@link DEFAULT_RATE_LIMIT}; both share the proxy-awareness
 * follow-up in security-review.md §3.
 */
export const DEFAULT_RECOVERY_RATE_LIMIT: RateLimit = {
  max: 10,
  windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
};

/**
 * The set of reverse proxies the relay trusts to set `X-Forwarded-For`, used to
 * recover the real client IP for the per-IP rate limiters when the relay runs
 * behind a proxy/load balancer (otherwise every client looks like the proxy and
 * the throttles collapse to one shared bucket — security-review.md §3). Each
 * entry is an IP, a CIDR range (`10.0.0.0/8`), or a `proxy-addr` preset name
 * (`loopback`, `linklocal`, `uniquelocal`).
 *
 * **Empty by default — the secure default.** With no trusted proxy, the client
 * IP is taken from the raw socket and a (spoofable) `X-Forwarded-For` is ignored,
 * so a forged header can't mint fresh rate-limit buckets. Only widen this to the
 * actual proxies in front of the relay.
 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = [];

/**
 * The env vars the relay reads, named in one place so the set of override knobs
 * is discoverable and a rename touches a single line. Resolution (parsing,
 * defaulting) lives at the call sites (`index.ts`, `relay.ts`); this is only the
 * registry of names.
 */
export const ENV = {
  /** HTTP port (default {@link DEFAULT_PORT}). */
  port: "PORT",
  /** Store path or `:memory:` (default {@link DEFAULT_DB_PATH}). */
  dbPath: "RELAY_DB",
  /** When set, gates `POST /accounts` on a matching `X-Registration-Token`. */
  registrationToken: "RELAY_REGISTRATION_TOKEN",
  /** Enumeration throttle overrides (default {@link DEFAULT_RATE_LIMIT}). */
  rateLimitMax: "RELAY_RATE_LIMIT_MAX",
  rateLimitWindowMs: "RELAY_RATE_LIMIT_WINDOW_MS",
  /** Recovery throttle overrides (default {@link DEFAULT_RECOVERY_RATE_LIMIT}). */
  recoveryRateLimitMax: "RELAY_RECOVERY_RATE_LIMIT_MAX",
  recoveryRateLimitWindowMs: "RELAY_RECOVERY_RATE_LIMIT_WINDOW_MS",
  /**
   * Comma-separated trusted reverse-proxy IPs / CIDR ranges / `proxy-addr` preset
   * names (`loopback`, `uniquelocal`); empty/unset trusts none (default
   * {@link DEFAULT_TRUSTED_PROXIES}). Enables `X-Forwarded-For`-aware client IPs
   * for the rate limiters when behind a proxy.
   */
  trustedProxies: "RELAY_TRUSTED_PROXIES",
} as const;
