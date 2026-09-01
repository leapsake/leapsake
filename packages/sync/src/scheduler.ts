/**
 * Seamless background sync: the *scheduling* layer over {@link runAccountSync}.
 *
 * Convergence has two halves, and a single trigger can't cover both, so this
 * module supplies the primitives clients use to drive sync from real events
 * rather than a poll:
 *
 * - **push** (your edits go out) is best triggered by the local write itself —
 *   the debounced {@link SyncScheduler.kick} below, wired through
 *   {@link withSyncKick}, so a burst of edits collapses to one push;
 * - **pull** (the peer's edits come in) has no local event, so clients call
 *   {@link SyncScheduler.trigger} on app foreground / window focus;
 * - a long {@link SYNC_INTERVAL_MS} interval is only a backstop for the "both
 *   apps open and focused while the peer edits" gap. It is the *only* part with
 *   idle cost, which is why it is long and event-driven triggers do the work.
 *
 * The scheduler owns scheduling only — the actual work (and the "is sync even
 * enabled" guard) is the injected `run` thunk — so it is pure and unit-testable
 * with fake timers, and platform-agnostic (`setInterval`/`setTimeout` exist on
 * both Node and Hermes).
 */

/** The backstop interval. Long on purpose: events drive the common case, and on
 *  mobile a JS interval only fires while foregrounded anyway. */
export const SYNC_INTERVAL_MS = 15 * 60_000;

/** How long {@link SyncScheduler.kick} waits before syncing, so a burst of local
 *  edits coalesces into a single push. */
export const SYNC_KICK_DEBOUNCE_MS = 2_000;

export interface SyncScheduler {
  /**
   * Run a sync now unless one is already in flight (single-flight). Resolves to
   * the run's result, or `undefined` if it was coalesced into the in-flight run
   * or the injected `run` guard skipped it (sync not enabled). This is the
   * **manual** path (the "Sync now" button): it always runs, ignoring the
   * automatic-sync preference. Automatic callers use {@link autoTrigger}.
   */
  trigger(): Promise<{ at: number; applied?: number } | undefined>;
  /**
   * The **automatic** counterpart to {@link trigger}: runs a sync only when
   * automatic sync is enabled (see {@link setAutoEnabled}), else resolves
   * `undefined` without doing anything. Every event-driven caller (launch,
   * window focus / app foreground, post-enable/join) uses this so the user's
   * "Sync automatically" toggle gates them while the manual button keeps working.
   *
   * Unlike {@link trigger}, this **never rejects** — a failure is routed to
   * `onError` and then swallowed. The automatic path is fire-and-forget (callers
   * invoke it as `void scheduler.autoTrigger()`), so a rejection here would
   * otherwise escape as an unhandled promise rejection.
   */
  autoTrigger(): Promise<{ at: number; applied?: number } | undefined>;
  /**
   * Debounced trigger for high-frequency events (local writes): (re)schedule a
   * {@link trigger} after {@link SYNC_KICK_DEBOUNCE_MS}, resetting the timer on
   * each call. A no-op while automatic sync is disabled. Fire-and-forget.
   */
  kick(): void;
  /**
   * Enable or disable *automatic* sync (the per-client "Sync automatically"
   * preference). While disabled, {@link autoTrigger}, {@link kick}, and the
   * backstop interval are inert, but {@link trigger} (manual) still works.
   * Re-enabling fires one catch-up sync; disabling cancels any pending kick.
   * Only changes in-memory behaviour — the caller persists the preference.
   */
  setAutoEnabled(enabled: boolean): void;
  /** Start the periodic backstop interval. Idempotent. */
  start(): void;
  /** Stop the interval and cancel any pending kick. In-flight runs still resolve. */
  stop(): void;
}

export function createSyncScheduler(opts: {
  /** The work + guard. Return `undefined` to signal "skipped" (e.g. not enabled). */
  run: () => Promise<{ at: number; applied?: number } | undefined>;
  intervalMs?: number;
  debounceMs?: number;
  /** Whether *automatic* sync starts enabled (the persisted preference). Default `true`. */
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
    // Single-flight: a focus during an interval run, or a kick during a manual
    // sync, all share the one outstanding run rather than stacking up.
    if (inFlight !== undefined) return inFlight;
    const started = (async () => {
      try {
        const result = await run();
        if (result !== undefined) onResult?.(result);
        return result;
      } catch (error) {
        // Never let a background failure (relay down) escape into a timer/
        // interval callback and crash the host. Manual callers still see the
        // rejection because trigger() returns this promise to them.
        onError?.(error);
        throw error;
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = started;
    return started;
  }

  // The automatic path: identical to trigger() but gated on the preference, so a
  // disabled "Sync automatically" silently no-ops every event-driven sync. It
  // also swallows the rejection trigger() rethrows — onError has already seen the
  // failure (e.g. a 401 → re-auth prompt), and every caller fires this as
  // `void autoTrigger()`, so rethrowing would surface as an unhandled rejection.
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
        // Swallow rejections: kick() is fire-and-forget and onError already saw it.
        void trigger().catch(() => {});
      }, debounceMs);
    },
    setAutoEnabled(enabled: boolean) {
      if (enabled === autoEnabled) return;
      autoEnabled = enabled;
      if (enabled) {
        // The user just re-enabled automatic sync: catch up now rather than
        // waiting for the next focus/write/interval. (autoTrigger never rejects.)
        void autoTrigger();
      } else if (kickTimer !== undefined) {
        // Cancel a write-debounced push that was queued before the user opted out.
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

/**
 * Names of {@link CoreApi} methods that *mutate* state and so should trigger a
 * sync. Everything else (`list`/`get`/`*For*`/`query`/the view builders) is a
 * read and passes through untouched.
 *
 * **This list must grow by hand when a write is named something new**, because a
 * predicate on *names* can only catch the names it was told about. A write that
 * matches nothing here is silently treated as a read: it lands locally and then
 * waits for the next scheduled tick instead of kicking a push.
 *
 * What stops that going unnoticed is `with-sync-kick.test.ts`, which pins the
 * **whole** `CoreApi` surface with each method classified `read` or `write` by
 * hand. Any method added to core fails that test until it is classified, and any
 * method classified `write` that this predicate does not match fails it too. An
 * earlier version pinned only the predicate's own output, which could not work:
 * filtering the surface through the very predicate under test makes a write it
 * does not match invisible rather than wrong. Every entry below past the original
 * `create|update|edit|softDelete` was a gap found in production, not by a test —
 * `snooze`, then `setPolicy`/`setPermissionState` for the cross-device
 * notification policy (`plans/v0-1_08_local-notifications.md`), then a batch of
 * nine (`commit`, `merge`, `reject`, `clear`, `regenerate`, and `set` widened to
 * cover `holidays.set*` and `self.set`).
 *
 * `set` is deliberately the bare prefix rather than the three exact names it
 * replaced: every `set*` on the surface is a write, and a hypothetical read named
 * `settingsFor` costing one wasted push is the cheap direction to err in — a
 * missed write costs a stale device instead.
 *
 * TODO: consider retiring the predicate for **observation** instead of naming.
 * Have {@link SqliteDriver} raise a dirty flag on `run`/`exec` and kick when a
 * wrapped call flips it — then "did this write?" is answered by what the call
 * actually did, there is no list to keep, and the whole class of bug this comment
 * documents stops existing. Not done yet because it needs a decision about the
 * writes that should *not* push: migrations, and the internal reconciles
 * (`regenerateSystem`) that already ride their caller's kick. The surface pin in
 * `with-sync-kick.test.ts` makes the naming approach survivable in the meantime,
 * so this is a cleanup to take when it next causes trouble, not a live defect.
 */
const MUTATING_METHOD =
  /^(create|update|edit|softDelete|merge|dismiss|undismiss|reject|set|clear|snooze|capture|commit|regenerate)/;

/**
 * Wrap a {@link CoreApi}-shaped object so that every mutating method calls `kick`
 * after it resolves, at a single seam — clients don't have to remember to kick
 * after each write. Recurses into nested groups (e.g. `contactMethods.emails`).
 * Reads pass through; rejections propagate without a kick (nothing landed).
 *
 * Typed generically over the input shape so it returns the same type it was
 * given (the client keeps its `CoreApi`), and so this stays decoupled from the
 * `CoreApi` type defined in the index module.
 */
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
