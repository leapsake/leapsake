import type { CoreApi } from "@leapsake/core";
import type { GiftsPorts } from "@leapsake/ui/web";

/**
 * The gift ports for the **browser** client — `apps/desktop/src/renderer/src/
 * lib/gifts-ports.ts` with `window.api` replaced by `core`, and nothing else.
 *
 * Its sibling `../gifts-ports-ssr.ts` throws from every method, because on the
 * server a port firing during render is a bug worth surfacing. That assertion
 * had a stated limit: `renderToString` never runs effects, so a section that
 * loads through `useEffect` is invisible to it. **In a browser the effects run**,
 * so those ports are called for real and this file is what answers them — which
 * makes the client the first host in the spike to exercise the parts of
 * `@leapsake/ui` the no-JS floor leaves inert.
 *
 * Built once per `core` rather than per render, for the reason desktop's
 * docblock gives: the components hold these functions in effect dependency
 * arrays, so a fresh object each render re-fetches every party's occasions on
 * every keystroke.
 */
export function clientGiftsPorts(core: CoreApi): GiftsPorts {
  return {
    loadOccasions: (party) => core.gifts.occasionsFor(party.type, party.id),
    loadGiven: (party) => core.gifts.given.listForRecipient(party.type, party.id),
    loadOccurrences: (holidayId, year) =>
      core.holidays.occurrencesIn(holidayId, year),
    capture: (input) => core.gifts.capture(input),
    createSuggestion: (input) => core.gifts.suggestions.create(input),
    updateSuggestion: (id, patch) => core.gifts.suggestions.update(id, patch),
    removeSuggestion: (id) => core.gifts.suggestions.softDelete(id),
    updateGiving: (id, patch) => core.gifts.given.update(id, patch),
    removeGiving: (id) => core.gifts.given.softDelete(id),
  };
}
