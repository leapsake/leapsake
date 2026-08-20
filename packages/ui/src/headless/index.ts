/**
 * `@leapsake/ui/headless` — behavior without markup.
 *
 * Hooks, domain rules and feature ports here touch no DOM, so they are shared by
 * the web components in `../web` and are read directly by `apps/mobile`'s React
 * Native components. Anything that renders a *host* element belongs in `../web`;
 * a React context is neutral and belongs here.
 */
export {
  type GivingRow,
  type IdeaOccasionRow,
  type PartyContexts,
  type PartyLoaders,
  type RecipientEntry,
  type SuggestionFields,
  captureRecipientOf,
  givingsOf,
  ideaOccasionRowsOf,
  ideaOccasionsOf,
  newGivingRow,
  newIdeaOccasionRow,
  newSuggestionFields,
  occasionKey,
  occasionOfKey,
  partyKey,
  patchRecipient,
  removeRecipient,
  resolveStagedOccasion,
  usePartyContext,
} from "./gift-form.js";
export {
  GiftsPortsProvider,
  useGiftsPorts,
  type GiftCaptureInput,
  type GiftOccasionChoice,
  type GiftsPorts,
  type GivenRow,
  type IdeaSuggestionRow,
  type PartyOption,
  type SuggestionRow,
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
