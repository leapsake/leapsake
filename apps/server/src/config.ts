// Every relay tunable's default and env-var name, so a new knob lands here
// rather than as a literal in the request path.

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

/** The largest request body the relay reads; anything bigger gets a 413. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Shared default window for both throttles. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** A session token's lifetime: short, as it travels on every request, and a
 *  device silently logs in again (threat H3). */
export const DEFAULT_SESSION_TTL_MS = 60 * 60_000;

/** The generous throttle on the unauthenticated enumeration routes. */
export const DEFAULT_RATE_LIMIT: RateLimit = {
  max: 60,
  windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
};

/** The tighter throttle on the recovery-authenticated routes. */
export const DEFAULT_RECOVERY_RATE_LIMIT: RateLimit = {
  max: 10,
  windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
};

/** The tight throttle on failed logins, against online password grinding
 *  (threat H2). */
export const DEFAULT_BOOTSTRAP_RATE_LIMIT: RateLimit = {
  max: 10,
  windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
};

/** The proxies trusted to set `X-Forwarded-For`; none by default, so a forged
 *  header can't mint fresh rate-limit buckets. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = [];

/** The env vars the relay reads; parsing them is the call sites' job. */
export const ENV = {
  /** HTTP port (default {@link DEFAULT_PORT}). */
  port: "PORT",
  /** Store path or `:memory:` (default {@link DEFAULT_DB_PATH}). */
  dbPath: "RELAY_DB",
  /** Request body cap in bytes (default {@link DEFAULT_MAX_BODY_BYTES}). */
  maxBodyBytes: "RELAY_MAX_BODY_BYTES",
  /** When set, gates `POST /accounts` on a matching `X-Registration-Token`. */
  registrationToken: "RELAY_REGISTRATION_TOKEN",
  /** Enumeration throttle overrides (default {@link DEFAULT_RATE_LIMIT}). */
  rateLimitMax: "RELAY_RATE_LIMIT_MAX",
  rateLimitWindowMs: "RELAY_RATE_LIMIT_WINDOW_MS",
  /** Recovery throttle overrides. */
  recoveryRateLimitMax: "RELAY_RECOVERY_RATE_LIMIT_MAX",
  recoveryRateLimitWindowMs: "RELAY_RECOVERY_RATE_LIMIT_WINDOW_MS",
  /** Failed-login throttle overrides. */
  bootstrapRateLimitMax: "RELAY_BOOTSTRAP_RATE_LIMIT_MAX",
  bootstrapRateLimitWindowMs: "RELAY_BOOTSTRAP_RATE_LIMIT_WINDOW_MS",
  /** Session-token lifetime in ms (default {@link DEFAULT_SESSION_TTL_MS}). */
  sessionTtlMs: "RELAY_SESSION_TTL_MS",
  /** In-process TLS (Option B): PEM fullchain and key paths, both or
   *  neither. */
  tlsCert: "RELAY_TLS_CERT",
  tlsKey: "RELAY_TLS_KEY",
  tlsKeyPassphrase: "RELAY_TLS_KEY_PASSPHRASE",
  /** Comma-separated trusted proxies; see {@link DEFAULT_TRUSTED_PROXIES}. */
  trustedProxies: "RELAY_TRUSTED_PROXIES",
} as const;
