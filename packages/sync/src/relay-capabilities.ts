/**
 * What a relay says it does for you — asked, never assumed (`model.md` §7.3.1).
 *
 * Forgetting an account on its **last remaining device** is functionally a
 * deletion *unless some server durably holds a copy*, and whether one does is a
 * property of **who is hosting**, not of the account: `sync.md` §2 designs the
 * relay to be disposable (devices self-heal it), and a self-hoster may or may not
 * back their volume up. So the client asks the relay, and — the load-bearing part
 * — **treats silence as "no".** Defaulting to no fails safely: the worst outcome
 * is over-warning about a deletion that was in fact recoverable.
 *
 * This exists as a *check* rather than a hardcoded warning string on purpose. When
 * server-side backup does ship, the alarming copy has to stop appearing on its
 * own rather than be hunted down.
 */

/** The path a relay serves its capability document from, if it serves one. */
const CAPABILITIES_PATH = "/capabilities";

/**
 * Give up quickly. This runs to decide the wording of a confirmation dialog, so a
 * relay that is slow or gone must not hold the dialog hostage — and timing out
 * lands on the safe default anyway.
 */
const PROBE_TIMEOUT_MS = 3000;

/** What a relay advertises about itself. One field so far. */
export interface RelayCapabilities {
  /**
   * Whether this relay keeps a **durable copy** of account data — i.e. whether
   * signing back in after forgetting the last device would get the data back.
   *
   * `false` is both the default and, today, always the answer: no relay
   * implements the endpoint yet, and the protocol shape is still an open question
   * (`plans/status.md` → Open questions → Custody). The client side is built
   * first so the honest wording is already driven by a check.
   */
  durableBackup: boolean;
}

/** The answer when nobody said otherwise: assume the relay is not a backup. */
export const NO_DURABLE_BACKUP: RelayCapabilities = { durableBackup: false };

/**
 * Ask `relayUrl` what it offers, falling back to {@link NO_DURABLE_BACKUP} on
 * *anything* unexpected — no relay bound, endpoint absent (today's universal
 * case), network down, non-JSON body, or a `durableBackup` that isn't a boolean.
 *
 * It never throws and never authenticates: the document says nothing about any
 * account, so there is no credential to attach and no reason to make the caller
 * hold one.
 */
export async function fetchRelayCapabilities(opts: {
  /** Absent for a local-only account — which resolves to the safe default. */
  relayUrl?: string;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}): Promise<RelayCapabilities> {
  const { relayUrl, fetchImpl = globalThis.fetch } = opts;
  if (relayUrl === undefined || relayUrl.trim() === "") {
    return NO_DURABLE_BACKUP;
  }

  try {
    const response = await fetchImpl(
      new URL(CAPABILITIES_PATH, relayUrl).toString(),
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) return NO_DURABLE_BACKUP;
    const body: unknown = await response.json();
    const durableBackup = (body as RelayCapabilities | null)?.durableBackup;
    // Only a literal `true` counts. A relay that omits the field, or answers with
    // something truthy-but-not-boolean, has not made the promise.
    return { durableBackup: durableBackup === true };
  } catch {
    return NO_DURABLE_BACKUP;
  }
}
