/**
 * `@leapsake/ui/web` — the DOM half of Leapsake's shared UI: strictly
 * presentational components that take data as props and get navigation + form
 * submission from an injected {@link UiAdapter}. They never read a router, never
 * touch `window.api`, and never own a write.
 *
 * Imported through this subpath rather than a package root so a React Native
 * renderer could be added at `./native` without DOM code entering Metro's module
 * graph. `./tokens` is the platform-neutral third subpath.
 *
 * See `packages/ui/README.md` for the contract and
 * `plans/ui-extraction.md` for the increments still to come.
 */
export {
  UiProvider,
  useUi,
  type UiAdapter,
  type UiFormProps,
  type UiLinkProps,
} from "./adapter.js";
export {
  highlightBirthday,
  highlightMatch,
  type HighlightMode,
} from "./highlight.js";
export { ConfirmDelete } from "./patterns/ConfirmDelete.js";
export { Breadcrumbs, type Crumb } from "./primitives/Breadcrumbs.js";
export {
  Combobox,
  ComboboxOptionDetail,
  type ComboboxFieldAria,
} from "./primitives/Combobox.js";
export { ContactMethodsSection } from "./sections/ContactMethodsSection.js";
export {
  HolidaysSection,
  type BearerHoliday,
} from "./sections/HolidaysSection.js";
export { MentionedInSection } from "./sections/MentionedInSection.js";
export { MilestonesSection } from "./sections/MilestonesSection.js";
export { RelationshipsSection } from "./sections/RelationshipsSection.js";
export { TagsSection } from "./sections/TagsSection.js";
export { DataTable, type Column } from "./primitives/DataTable.js";
export { DetailList, type Detail } from "./primitives/DetailList.js";
export { MultiAddCombobox } from "./primitives/MultiAddCombobox.js";
export { EmptyState, Section } from "./primitives/Section.js";
export { GenderField } from "./primitives/GenderField.js";
export { GenderValue, type GenderResult } from "./primitives/GenderValue.js";
