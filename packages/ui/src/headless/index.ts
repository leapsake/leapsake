/**
 * `@leapsake/ui/headless` — behavior without markup.
 *
 * Hooks, domain rules and feature ports here touch no DOM, so they are shared by
 * the web components in `../web` and are read directly by `apps/mobile`'s React
 * Native components. Anything that renders a *host* element belongs in `../web`;
 * a React context is neutral and belongs here.
 */
export {
  type RecipientEntry,
  captureRecipientOf,
  giftIdeaOf,
  newRecipientEntry,
  partyKey,
  patchRecipient,
  removeRecipient,
} from "./gift-form.js";
export { giftUrlLabel, giftUrlOf, pastedIntoField } from "./gift-url.js";
export {
  GiftsPortsProvider,
  useGiftsPorts,
  type GiftCaptureInput,
  type GiftRecipientRow,
  type GiftsPorts,
  type IdeaRecipientRow,
  type PartyOption,
} from "./gifts-ports.js";
export {
  type DateFields,
  type PartialDate,
  datePart,
  dateFieldsOf,
  emptyDate,
  parseDateFields,
} from "./partial-date.js";
export {
  entityBasePath,
  neighborKey,
  neighborPath,
  relationshipEditPath,
  relationshipRemovePath,
  searchHitPath,
} from "./routes.js";
export { formatTimestamp } from "./timestamps.js";
export { useDebouncedSearch } from "./useDebouncedSearch.js";
export { useSerializedWrites } from "./useSerializedWrites.js";
export { useTypeahead } from "./useTypeahead.js";
