import { useNavigation } from "react-router-dom";

/**
 * Whether a route submission is in flight — the one piece of router state the
 * presentational components take as a prop rather than reading themselves.
 *
 * Every form and confirm screen needs it, and spelling out
 * `useNavigation().state === "submitting"` in each was the sort of repetition
 * that eventually gets one of them subtly wrong.
 */
export function useSubmitting(): boolean {
  return useNavigation().state === "submitting";
}
