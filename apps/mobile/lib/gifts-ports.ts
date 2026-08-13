import { useMemo } from "react";
import type { PartyLoaders } from "@leapsake/ui/headless";
import { useCore } from "./core-context";

/**
 * Mobile's half of `@leapsake/ui`'s gift ports: the two party reads the shared
 * capture-form logic makes, over the in-process `CoreApi` — desktop's
 * `renderer/src/lib/gifts-ports.ts` is the same interface over IPC.
 *
 * Only the reads, because only the reads are shared. Mobile's own gift components
 * call `useCore()` directly, as every other mobile screen does; a full
 * `GiftsPorts` implementation would mean seven methods nothing calls and one
 * convention for gifts and another for everything else.
 *
 * Memoized on the core: `usePartyContext` holds these in effect dependencies, and
 * a fresh object per render would re-fetch every party's context on every
 * keystroke.
 */
export function useGiftPartyLoaders(): PartyLoaders {
  const core = useCore();
  return useMemo(
    () => ({
      loadOccasions: (party) => core.gifts.occasionsFor(party.type, party.id),
      loadGiven: (party) =>
        core.gifts.given.listForRecipient(party.type, party.id),
    }),
    [core],
  );
}
