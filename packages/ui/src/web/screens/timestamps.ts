/**
 * Render an epoch-ms timestamp in the user's locale — the “Created”/“Updated”
 * footer every view screen carries.
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}
