import type { GiftsPorts } from "@leapsake/ui/web";

/**
 * Desktop's implementation of `@leapsake/ui`'s gift ports — every read and write
 * the gift surfaces need, forwarded to the typed IPC bridge.
 *
 * Defined at module scope so its methods keep a stable identity: the components
 * hold them in effect dependencies, and a fresh object per render would re-fetch
 * every party's occasions on every keystroke.
 */
export const desktopGiftsPorts: GiftsPorts = {
  loadOccasions: (party) => window.api.gifts.occasionsFor(party.type, party.id),
  loadGiven: (party) =>
    window.api.gifts.given.listForRecipient(party.type, party.id),
  loadOccurrences: (holidayId, year) =>
    window.api.holidays.occurrencesIn(holidayId, year),
  capture: (input) => window.api.gifts.capture(input),
  createSuggestion: (input) => window.api.gifts.suggestions.create(input),
  updateSuggestion: (id, patch) =>
    window.api.gifts.suggestions.update(id, patch),
  removeSuggestion: (id) => window.api.gifts.suggestions.softDelete(id),
  updateGiving: (id, patch) => window.api.gifts.given.update(id, patch),
  removeGiving: (id) => window.api.gifts.given.softDelete(id),
};
