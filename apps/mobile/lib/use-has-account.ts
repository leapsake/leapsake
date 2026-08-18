import { useEffect, useState } from "react";
import { usePathname } from "expo-router";
import { useDataVersion, useSync } from "./core-context";

/**
 * Whether this device holds an account — `undefined` until the first read
 * lands.
 *
 * The app has no sign-in wall and no auth store: an account is *invited, never
 * required* (`AGENTS.md` → Product posture), so "signed in" is a property of
 * custody rather than a session, and every screen that needs it has always asked
 * `sync.status()` for itself. This is the first shared reader, because the tab
 * bar needs the answer continuously rather than once per screen.
 *
 * **What makes it re-read**, given there is nothing to subscribe to:
 *
 * - {@link useDataVersion}, so a peer creating the account on another device is
 *   picked up by the same reactive invalidation every screen uses.
 * - the current pathname, which is the cheap proxy for "the user has been
 *   somewhere and come back". Account creation happens on a pushed screen, so
 *   walking back off it is exactly when the answer can have changed — and it is
 *   a re-render the tab layout is already doing.
 *
 * That is deliberately not a subscription. A poll would burn a timer for an
 * event that happens once in a device's life, and threading a bump out of
 * account creation would put a UI concern into the custody path for one label.
 */
export function useHasAccount(): boolean | undefined {
  const sync = useSync();
  const version = useDataVersion();
  const pathname = usePathname();
  const [hasAccount, setHasAccount] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void sync
      .status()
      .then((status) => {
        if (active) setHasAccount(status.hasAccount);
      })
      // An unreadable status is not a signed-in device. Falling back to "no"
      // shows the accountless tab, which offers to create one — the same thing
      // a fresh install shows, and the harmless direction to be wrong in.
      .catch(() => {
        if (active) setHasAccount(false);
      });
    return () => {
      active = false;
    };
  }, [sync, version, pathname]);

  return hasAccount;
}
