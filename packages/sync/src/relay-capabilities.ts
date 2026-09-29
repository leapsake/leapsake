// What a relay says it does for you, asked and never assumed; silence is
// “no”. See the README's _Asking the relay_.

/** The path a relay serves its capability document from, if it serves one. */
const CAPABILITIES_PATH = "/capabilities";

/** Short, so a slow relay can't hold a dialog hostage; a timeout is “no”. */
const PROBE_TIMEOUT_MS = 3000;

/** What a relay advertises about itself. One field so far. */
export interface RelayCapabilities {
  /** Whether forgetting the last device could be undone by signing back in. */
  durableBackup: boolean;
}

/** The answer when nobody said otherwise: assume the relay is not a backup. */
export const NO_DURABLE_BACKUP: RelayCapabilities = { durableBackup: false };

/** Asks a relay what it offers, unauthenticated; anything unexpected is
 *  {@link NO_DURABLE_BACKUP}, and it never throws. */
export async function fetchRelayCapabilities(opts: {
  /** Absent for a local-only account, which gets the safe default. */
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
    // Only a literal `true` makes the promise.
    return { durableBackup: durableBackup === true };
  } catch {
    return NO_DURABLE_BACKUP;
  }
}
