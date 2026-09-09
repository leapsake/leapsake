/**
 * `@leapsake/vcard` — the vCard format, both directions, kept as its own
 * narrowly-scoped, independently-testable unit outside `@leapsake/core`. It owns
 * two format-specific concerns — **detecting** what a file is and **parsing** it
 * into a Leapsake-shaped {@link ParsedContact} — and one format-agnostic concern
 * — **ingesting** those contacts through injected ports.
 *
 * **Named for the format rather than the direction** (it was
 * `@leapsake/contact-import`) because the exporter belongs here too: writing a
 * card is the same grammar inverted — fold against `unfold`, escape against
 * `unescapeValue`, the same label and platform maps read backwards — and the one
 * test that matters most, `parseVCards(write(x)) ≡ x`, only exists if both halves
 * live together. See [`../README.md`](../README.md).
 *
 * It depends only on `@leapsake/schema` (the `Gender` enum and, later, nothing
 * else) and a small set of injected ports ({@link ImportPorts}) — never on
 * `@leapsake/core` or `@leapsake/data`. The composition root (`@leapsake/core`)
 * constructs the real ports over its repos and drives the ingest; the renderer
 * imports the pure parser/detector directly to read a dropped `File`.
 */
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
