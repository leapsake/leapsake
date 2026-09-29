// `@leapsake/vcard`: the vCard format both ways, and ingest through injected
// ports; it depends on `@leapsake/schema` alone.
export { appleLabelText, dateKindFor } from "./apple-labels.js";
export { detectContactFormat, parseVCards } from "./vcard.js";
export type { DetectedFormat } from "./vcard.js";
export { formatPartialDate, formatTimestamp, writeVCards } from "./write.js";
export type { ExportContact, WriteOptions } from "./write.js";
export { ingestContacts } from "./ingest.js";
export type {
  ImportDecision,
  ImportError,
  ImportPorts,
  ImportResult,
} from "./ingest.js";
export {
  importDecisionsSchema,
  nameInputFrom,
  parsedContactSchema,
  parsedContactsSchema,
} from "./parsed-contact.js";
export type {
  DroppedField,
  ParsedBirthday,
  ParsedContact,
  ParsedDate,
  ParsedEmail,
  ParsedName,
  ParsedPartialDate,
  ParsedPhone,
  ParsedPostal,
  ParsedRelated,
  ParsedSocial,
} from "./parsed-contact.js";
