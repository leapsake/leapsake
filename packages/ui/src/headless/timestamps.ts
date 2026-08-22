/**
 * Render an epoch-ms timestamp in the user's locale — the “Created”/“Updated”
 * footer every view screen carries.
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

/**
 * The same instant, short enough for a footer that carries both timestamps on
 * one line: no seconds, two-digit year. Bookkeeping is read at a glance or not
 * at all, and {@link formatTimestamp}'s full form is twice as wide for a
 * precision nobody wants from it.
 */
export function formatTimestampCompact(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
