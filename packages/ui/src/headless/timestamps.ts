/** An epoch-ms timestamp in the user's locale, for a view's footer. */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** The same instant with no seconds and a two-digit year, for one line. */
export function formatTimestampCompact(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
