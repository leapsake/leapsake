/**
 * `@leapsake/export` — **getting a user's whole store out of the app**, as one
 * archive they keep.
 *
 * v0.1 is single-device by construction, so the app container is the only place
 * a user's data exists. That makes this the difference between "delete and
 * reinstall" being an ordinary act and being data loss, which is why it gates
 * GA (`plans/shipping.md` → Part 1, step 1) rather than being a nicety.
 *
 * **It must never use iCloud.** Not a preference — no version of Leapsake may
 * ever ship an iCloud entitlement, or Apple's app-transfer criteria disqualify
 * the record permanently. What that forbids is `com.apple.developer.icloud-*` in
 * a shipped build; it does *not* forbid the user picking iCloud Drive out of the
 * system share sheet, which is their act and needs nothing from us. This package
 * only produces bytes, so it cannot violate that on its own — but a caller that
 * reaches for a cloud API to store them can.
 *
 * Shaped like `@leapsake/vcard`'s ingest half, and for the same reasons: the
 * data it needs arrives through injected {@link ExportPorts} rather than a repo
 * import, so it never depends on `@leapsake/core` or `@leapsake/data` and its
 * tests run with no sqlite driver. The composition root (`@leapsake/core`) wires
 * the real ports over its repos and exposes {@link buildArchive} as
 * `core.export.archive()`; each client only writes the bytes somewhere and hands
 * them to whatever "share a file" means on its platform.
 *
 * The archive holds the whole store: `contacts.vcf` is the person graph —
 * people, pets, their contact methods, every milestone kind and the
 * relationships between them — and `data.json` is everything that belongs to no
 * single card. Neither writes a fact the other does. The import side reads all
 * of it back except the file's own ids and timestamps, which only a restore may
 * apply (`plans/v0-2.md` → *Export*).
 */
export { buildArchive } from "./archive.js";
export { DATA_NAME, README_NAME, VCF_NAME } from "./archive.js";
export type { BuildOptions, ExportArchive } from "./archive.js";
export { toExportContact } from "./contact.js";
export {
  DATA_VERSION,
  buildExportData,
  exportDataSchema,
  exportGiftIdeaSchema,
  exportHiddenHolidaySchema,
  exportNotificationSettingsSchema,
  exportObservanceSchema,
  exportReminderSchema,
} from "./data.js";
export type { ExportData } from "./data.js";
export type { Dismissal, ExportDataPorts, ExportPorts } from "./ports.js";
