/**
 * `@leapsake/contact-import` — bringing a parsed address book into the store.
 *
 * The **seam with [`@leapsake/vcard`](../vcard/README.md) is the point of this
 * package.** That one owns the format and the ingest engine and depends on no
 * storage at all — it states so in its own entry point, and the exporter lives
 * there too so that `parseVCards(write(x)) ≡ x` can be one test. This package is
 * the other side: it builds vcard's `ImportPorts` over real repositories and
 * drives `ingestContacts` through them.
 *
 * Splitting them keeps `vcard` a pure format package rather than giving it a
 * `@leapsake/data` dependency. Repo ports arrive injected; the reminder
 * reconcile after a batch arrives as a port too, since that is
 * `@leapsake/reminders`' business.
 */
export { createImportApi } from "./api.js";
export type { AlreadyStored, ImportApiDeps } from "./api.js";
