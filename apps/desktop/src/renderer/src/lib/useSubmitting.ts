import { useNavigation } from "react-router-dom";

/** Whether a route submission is in flight. */
export function useSubmitting(): boolean {
  return useNavigation().state === "submitting";
}
