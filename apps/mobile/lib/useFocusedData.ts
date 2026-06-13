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
 *
 * `reload` re-runs `load` on demand for an in-place mutation (e.g. deleting a
 * milestone while staying on the detail screen, where no navigation re-focuses
 * the screen). Unlike the focus fetch it has no blur guard — the caller awaits it
 * directly — but it shares the same data/error update path.
 */
export function useFocusedData<T>(load: () => Promise<T>): {
  data: T | null;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    }, [load]),
  );

  return { data, error, reload };
}
