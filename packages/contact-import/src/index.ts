/**
 * `@leapsake/contact-import` — turning a dropped contact file into Leapsake
 * people, kept as its own narrowly-scoped, independently-testable unit outside
 * `@leapsake/core`. It owns two format-specific concerns — **detecting** what a
 * file is and **parsing** it into a Leapsake-shaped {@link ParsedContact} — and
 * one format-agnostic concern — **ingesting** those contacts through injected
 * ports.
 *
 * It depends only on `@leapsake/schema` (the `Gender` enum and, later, nothing
 * else) and a small set of injected ports ({@link ImportPorts}) — never on
 * `@leapsake/core` or `@leapsake/data`. The composition root (`@leapsake/core`)
 * constructs the real ports over its repos and drives the ingest; the renderer
 * imports the pure parser/detector directly to read a dropped `File`.
 */
export { detectContactFormat, parseVCards } from "./vcard.js";
export type { DetectedFormat } from "./vcard.js";
export { ingestContacts } from "./ingest.js";
export type {
  ImportDecision,
  ImportError,
  ImportPorts,
  ImportResult,
} from "./ingest.js";
export {
  importDecisionsSchema,
  parsedContactSchema,
  parsedContactsSchema,
} from "./parsed-contact.js";
export type {
  DroppedField,
  ParsedBirthday,
  ParsedContact,
  ParsedEmail,
  ParsedName,
  ParsedPhone,
  ParsedPostal,
} from "./parsed-contact.js";
