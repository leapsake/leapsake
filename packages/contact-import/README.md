# `@leapsake/contact-import`

Bringing a parsed address book into the store. `createImportApi(deps)` over injected repo
ports — the repo-backed half of an import.

## Why this is not part of `@leapsake/vcard`

[`@leapsake/vcard`](../vcard/README.md) owns the **format**: detecting what a file is, parsing
it into `ParsedContact`, writing cards back out, and the format-agnostic `ingestContacts`
engine that drives a set of injected `ImportPorts`. It depends on no storage, and says so in
its own entry point. That is deliberate — the exporter lives there too, so the test that
matters most, `parseVCards(write(x)) ≡ x`, can exist at all.

This package is the other side of that seam. It builds those `ImportPorts` over real
repositories and drives the ingest through them. Folding it into `vcard` would have given a
format package a `@leapsake/data` dependency; leaving it in `@leapsake/core` would have kept
230 lines of implementation in the composition root. So it is its own package, and `vcard`
stays pure.

The name is the one `vcard` used to carry, before it was renamed to say *format* rather than
*direction*. It fits here, where the direction genuinely is the subject.

## Two answers about an incoming card, kept apart

`preview` returns both, and they are not the same question:

- **`matches`** — what the card *resembles*, scored by `DuplicateService.matchContact` over
  names and contact methods.
- **`alreadyStored`** — what the card **is**, established by id. Our own exporter writes each
  entity's `people.id`/`pets.id` as the card's `UID`, so a card carrying one we hold is that
  entity coming home. This is what stops a user re-importing their own export from getting a
  second copy of everyone.

Folding the second into the first would mean saying "very likely already in Leapsake" about a
certainty, and would have nowhere to put a **pet** — `DuplicateMatch.personId` cannot honestly
hold a pet's id, and the duplicate detector's pool is published people alone.

Import still creates a **new** entity for an already-stored card; the review's job is to let
the user skip it. Writing the file's ids back is a restore, not this.

## Ports, not imports

`regenerateSystem` arrives injected rather than imported: reconciling the automated reminders
after a batch that created anything is `@leapsake/reminders`' business, and a batch reconciles
**once at the end** rather than per contact. Each contact otherwise commits in its own
transaction, so one bad row rolls back alone.
