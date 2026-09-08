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
 * The format — what goes in the `.vcf`, what goes in `data.json`, and why the
 * two are not the same fact written twice — is `plans/export.md`. **Today this
 * builds increment 1**: published people, their contact methods and their
 * birthday. Pets, unpublished people, the other milestone kinds and the
 * relationship graph are increment 2; `data.json`'s contents are increment 3.
 */
export { buildArchive, exportDataSchema } from "./archive.js";
export { DATA_NAME, DATA_VERSION, README_NAME, VCF_NAME } from "./archive.js";
export type { BuildOptions, ExportArchive, ExportData } from "./archive.js";
export { toExportContact } from "./contact.js";
export type { ExportPorts } from "./ports.js";
