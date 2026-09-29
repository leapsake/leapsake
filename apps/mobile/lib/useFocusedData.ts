import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useDataVersion } from "./core-context";

/**
 * Load on focus and on every {@link useDataVersion} bump; `load` must be
 * stable. `reload` re-runs it for an in-place change, with no blur guard.
 */
export function useFocusedData<T>(load: () => Promise<T>): {
  data: T | null;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();

  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load()
        .then((result) => {
          if (active) {
            setData(result);
            setError(null);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
      return () => {
        active = false;
      };
      // `version` is unread but re-runs the load when the provider writes.
    }, [load, version]),
  );

  return { data, error, reload };
}
