import { useRef, useState } from "react";

/** Chains writes so a rapid second pick can't overtake or drop the first. */
export function useSerializedWrites({
  onSuccess,
}: {
  /** Run after each write that lands — typically a re-read of the data. */
  onSuccess?: () => void;
} = {}) {
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    inFlight.current = inFlight.current
      .then(() => operation())
      .then(
        () => onSuccess?.(),
        // Recording the failure keeps the chain resolved, or every later
        // write would chain off the rejection and never run.
        (reason: unknown) => setError(String(reason)),
      )
      .finally(() => setBusy(false));
  }

  return { busy, error, run };
}
