/**
 * Format a `YYYY-MM-DD` holiday occurrence for display.
 *
 * Parsed into calendar parts rather than handed to `new Date(iso)`: that reads a
 * bare date string as **UTC midnight**, which renders the day before for anyone
 * west of Greenwich. An occurrence is a whole civil day, so it is built in local
 * time deliberately.
 *
 * Lives here rather than beside a screen because expo-router auto-registers
 * every module under `app/`, so a shared helper exported from a route file is
 * both a route and a utility — a seam worth not having.
 */
export function formatOccurrence(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
