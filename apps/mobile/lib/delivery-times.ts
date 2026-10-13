/** The times offered for a new delivery, in order of preference: evening, then
 *  midday, then later evening, then morning. */
const SUGGESTED_MINUTES = [19 * 60, 12 * 60, 21 * 60, 9 * 60];

/** The time a newly added delivery starts at: the first suggestion not
 *  already chosen, else the first free half-hour. */
export function nextDeliveryTime(chosen: readonly number[]): number {
  const taken = new Set(chosen);
  const free = [
    ...SUGGESTED_MINUTES,
    ...Array.from({ length: 48 }, (_, i) => i * 30),
  ].find((minute) => !taken.has(minute));
  return free ?? 0;
}
