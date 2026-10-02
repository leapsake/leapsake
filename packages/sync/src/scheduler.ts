// When to sync: debounced kicks push writes, focus pulls, and a long interval
// backs both up. The work itself is the injected `run`.

/** The backstop interval, long since events do the common case. */
export const SYNC_INTERVAL_MS = 15 * 60_000;

/** How long a kick waits, so a burst of edits becomes one push. */
export const SYNC_KICK_DEBOUNCE_MS = 2_000;

export interface SyncScheduler {
  /** Syncs now, joining any run in flight, whatever the automatic preference;
   *  `undefined` when coalesced or skipped. */
  trigger(): Promise<{ at: number; applied?: number } | undefined>;
  /** {@link trigger} when automatic sync is on; never rejects, since callers
   *  fire and forget it and `onError` has seen the failure. */
  autoTrigger(): Promise<{ at: number; applied?: number } | undefined>;
  /** Reschedules a {@link trigger} after the debounce; inert when automatic
   *  sync is off. */
  kick(): void;
  /** Turns automatic sync on, with one catch-up, or off, cancelling a kick;
   *  the caller persists it. */
  setAutoEnabled(enabled: boolean): void;
  /** Start the periodic backstop interval. Idempotent. */
  start(): void;
  /** Stops the interval and any pending kick; in-flight runs still resolve. */
  stop(): void;
}

export function createSyncScheduler(opts: {
  /** The work and its guard; `undefined` means skipped. */
  run: () => Promise<{ at: number; applied?: number } | undefined>;
  intervalMs?: number;
  debounceMs?: number;
  /** Whether automatic sync starts on; default `true`. */
  autoEnabled?: boolean;
  onResult?: (result: { at: number; applied?: number }) => void;
  onError?: (error: unknown) => void;
}): SyncScheduler {
  const {
    run,
    intervalMs = SYNC_INTERVAL_MS,
    debounceMs = SYNC_KICK_DEBOUNCE_MS,
    autoEnabled: autoEnabledInit = true,
    onResult,
    onError,
  } = opts;

  let autoEnabled = autoEnabledInit;
  let inFlight:
    | Promise<{ at: number; applied?: number } | undefined>
    | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let kickTimer: ReturnType<typeof setTimeout> | undefined;

  function trigger(): Promise<{ at: number; applied?: number } | undefined> {
    // Single-flight: every caller shares the one outstanding run.
    if (inFlight !== undefined) return inFlight;
    const started = (async () => {
      try {
        const result = await run();
        if (result !== undefined) onResult?.(result);
        return result;
      } catch (error) {
        // Reported here, so a timer callback never crashes the host; a manual
        // caller still sees the rejection.
        onError?.(error);
        throw error;
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = started;
    return started;
  }

  // trigger(), gated on the preference, swallowing the rejection `onError` saw.
  function autoTrigger(): Promise<
    { at: number; applied?: number } | undefined
  > {
    if (!autoEnabled) return Promise.resolve(undefined);
    return trigger().catch(() => undefined);
  }

  return {
    trigger,
    autoTrigger,
    kick() {
      if (!autoEnabled) return; // automatic sync off → don't push on writes
      if (kickTimer !== undefined) clearTimeout(kickTimer);
      kickTimer = setTimeout(() => {
        kickTimer = undefined;
        // Swallowed: onError already saw it.
        void trigger().catch(() => {});
      }, debounceMs);
    },
    setAutoEnabled(enabled: boolean) {
      if (enabled === autoEnabled) return;
      autoEnabled = enabled;
      if (enabled) {
        // Re-enabled: catch up now rather than at the next event.
        void autoTrigger();
      } else if (kickTimer !== undefined) {
        // Cancel a push queued before the user opted out.
        clearTimeout(kickTimer);
        kickTimer = undefined;
      }
    },
    start() {
      if (interval !== undefined) return; // idempotent
      // The timer keeps running even while automatic sync is off (so toggling
      // back on resumes without a restart); the tick itself is gated.
      interval = setInterval(() => {
        void autoTrigger(); // never rejects
      }, intervalMs);
    },
    stop() {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
      if (kickTimer !== undefined) {
        clearTimeout(kickTimer);
        kickTimer = undefined;
      }
    },
  };
}

/** The names of {@link CoreApi} writes, which must grow by hand; see the
 *  README's _Which calls kick a push_. */
const MUTATING_METHOD =
  /^(create|update|edit|softDelete|merge|dismiss|undismiss|reject|set|clear|snooze|capture|commit|regenerate|answer|link(?=[A-Z]))/;

/** Wraps a {@link CoreApi}-shaped object so every write, nested ones too,
 *  kicks once it resolves; a rejection kicks nothing. */
export function withSyncKick<T extends object>(core: T, kick: () => void): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(core as Record<string, unknown>)) {
    if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      out[key] = MUTATING_METHOD.test(key)
        ? (...args: unknown[]) => {
            const result = fn(...args);
            if (result instanceof Promise) {
              return result.then((resolved) => {
                kick();
                return resolved;
              });
            }
            kick();
            return result;
          }
        : fn;
    } else if (value !== null && typeof value === "object") {
      out[key] = withSyncKick(value, kick);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
