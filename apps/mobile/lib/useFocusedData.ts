import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Load async data whenever the screen gains focus. This is the lean equivalent
 * of the desktop router's loaders re-running on navigation: after a create /
 * edit / delete elsewhere navigates back here, the screen refocuses and the data
 * reloads, with no global store.
 *
 * `load` must be stable across renders (wrap it in `useCallback`), since the
 * fetch re-subscribes whenever its identity changes. A stale in-flight result is
 * dropped if the screen blurs before it resolves.
 */
export function useFocusedData<T>(load: () => Promise<T>): {
  data: T | null;
  error: string | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    }, [load]),
  );

  return { data, error };
}
