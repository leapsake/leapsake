import { useRef, useState } from "react";

/**
 * A queue for writes that must not overtake each other.
 *
 * Sections where a user can add or remove rows in quick succession — a holiday
 * observance, a gift suggestion — fire one write per interaction. Left
 * concurrent, a submission started mid-flight supersedes the previous one and a
 * pick made during a rapid type→Enter→type→Enter is silently dropped. Each
 * operation is therefore chained onto the last.
 *
 * **The rejection handler is what keeps the queue alive.** Without it a single
 * failed write leaves the chained promise rejected, every later operation chains
 * off that rejection and never runs, and the surface wedges with no visible
 * cause. Failures are recorded in `error` and the chain continues.
 */
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
        (reason: unknown) => setError(String(reason)),
      )
      .finally(() => setBusy(false));
  }

  return { busy, error, run };
}
