// `@leapsake/ui/web`: presentational DOM components; the contract is in
// `packages/ui/README.md`.
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
export { SearchBar } from "./SearchBar.js";
export { ReminderText } from "./primitives/ReminderText.js";
export { DropImportProvider } from "./import/DropImportProvider.js";
export {
  ImportReview,
  type ImportAlreadyStored,
  type ImportDecision,
  type ImportDuplicateMatch,
  type ImportOutcome,
  type ImportPreviewEntry,
} from "./import/ImportReview.js";
export { ChipTextField } from "./fields/ChipTextField.js";
export {
  RelationshipFields,
  StagedRelationshipsFields,
  type RelationshipCandidate,
} from "./fields/RelationshipFields.js";
export { ReminderPromptFields } from "./fields/ReminderPromptFields.js";
export { ReminderScheduleFields } from "./fields/ReminderScheduleFields.js";
export { WithWhomFields } from "./fields/WithWhomFields.js";
export {
  ContactMethodFields,
  ContactMethodForm,
} from "./forms/ContactMethodForm.js";
export { MilestoneFields, MilestoneForm } from "./forms/MilestoneForm.js";
export { PersonFields, PersonForm } from "./forms/PersonForm.js";
export { PetFields, PetForm } from "./forms/PetForm.js";
export { RelationshipForm } from "./forms/RelationshipForm.js";
export { GiftIdeaFields, GiftIdeaForm } from "./forms/GiftIdeaForm.js";
export { ReminderFields, ReminderForm } from "./forms/ReminderForm.js";
export { ConfirmDelete } from "./patterns/ConfirmDelete.js";
export { FormShell } from "./patterns/FormShell.js";
export { holdWhileSubmitting } from "./patterns/hold-while-submitting.js";
export { Field, StackedField } from "./primitives/Field.js";
export { Breadcrumbs, type Crumb } from "./primitives/Breadcrumbs.js";
export {
  Combobox,
  ComboboxOptionDetail,
  type ComboboxFieldAria,
} from "./primitives/Combobox.js";
export {
  GiftsPortsProvider,
  useGiftsPorts,
  type GiftCaptureInput,
  type GiftRecipientRow,
  type GiftsPorts,
  type IdeaRecipientRow,
  type PartialDate,
  type PartyOption,
} from "../headless/index.js";
export { GiftCaptureForm } from "./gifts/GiftCaptureForm.js";
export { GiftsSection } from "./sections/GiftsSection.js";
export { GiftIdeaRecipientsSection } from "./sections/GiftIdeaRecipientsSection.js";
export { PersonScreen } from "./screens/PersonScreen.js";
export { PetScreen } from "./screens/PetScreen.js";
export {
  RelationshipScreen,
  type RelationshipPartner,
} from "./screens/RelationshipScreen.js";
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
