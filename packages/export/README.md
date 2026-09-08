# `@leapsake/export`

**Getting a user's whole store out of the app, as one archive they keep.**

v0.1 is single-device by construction, so the app container is the only place a user's data
exists. That is what makes this the difference between "delete and reinstall" being an ordinary
act and being data loss — and why it gates GA rather than being a nicety. The format and the
remaining increments are [`plans/export.md`](../../plans/export.md); this file is why the package
is shaped the way it is.

## ⚠️ It must never use iCloud

**No version of Leapsake may ever ship an iCloud entitlement.** Not a preference — Apple's
app-transfer criteria disqualify a record that has one, permanently, and the transfer is a
one-way door the whole v0.1 sequence is built around.

What that forbids is `com.apple.developer.icloud-*` in a shipped build. It does **not** forbid the
user choosing iCloud Drive from the system share sheet: that is their act through
`UIDocumentPickerViewController` and needs nothing from us. This package only produces bytes, so
it cannot violate the rule on its own — **a caller that reaches for a cloud API to store them
can.** Two things follow, and both live in the client:

- `expo-sharing` is in `apps/mobile` **without its config plugin**. That plugin is for the
  *inbound* share extension and adds an App Group entitlement; the outbound `Sharing.shareAsync`
  we use needs no plugin at all.
- The archive is written to **`Library/Caches`, never the documents directory**. Caches is
  excluded from device backup, so a plaintext dump of somebody's whole address book cannot ride
  along inside an iCloud device backup. This is the one way the feature could break the rule by
  accident, and it is a one-word difference in the calling code.

## Injected ports, like the ingest half

`ExportPorts` is the mirror of `@leapsake/vcard`'s `ImportPorts`, and exists for the same reasons:
the builder unit-tests against an in-memory fake with no sqlite driver, and this package never
depends on `@leapsake/core` or `@leapsake/data`. The composition root wires the real ports over
its repos and exposes `buildArchive` as `core.export.archive()`; each client only writes the bytes
somewhere and hands them to whatever "share a file" means on its platform.

`appVersion` and `now` are injected too. That keeps the package pure, and it is what lets a test
assert the filename and the README — a builder that read the clock could only be tested for shape.

## Soft-deleted rows are excluded structurally, not by a predicate

An export is a snapshot of what the app holds, and tombstones here are a sync mechanism rather
than a recycle bin. Three reasons they stay out:

1. The export is the **one artifact that leaves the device**, so shipping rows the user told the
   app to forget is a privacy surprise we could not take back.
2. It would not round-trip: vCard cannot say "deleted", so every third-party import would
   resurrect them as live contacts.
3. Dropping a deleted person while keeping something that points at them yields a dangling
   reference — so the exclusion has to be **transitive**.

The third is the interesting one, and it needs no code here: `@leapsake/data` bakes
`deleted_at IS NULL` into `createEntityRepo`'s `listWhere` and `get`, and into
`tags.listForEntity`'s join, so **every read an implementation of `ExportPorts` can make is
already live-rows-only**. There is no query available that could produce the dangling reference.
`plans/export.md` originally asked for an `includeDeleted` parameter to make this cheap to
revisit; it turned out to be unnecessary, and adding one would be the thing that lets a future
caller opt *into* the surprise.

`listPeople` likewise answers only **published** people (`people.list()` carries `PUBLISHED_SQL`).
Somebody who exists only as a fact about another person belongs on that person's card as a
`RELATED`, which is increment 2 — not on a card of their own.

## The archive

```
leapsake-export-2026-09-07.zip
├── contacts.vcf   the person graph
├── data.json      everything not person-shaped (versioned; still nearly empty)
└── README.txt     what these are, what wrote them, how to get them back
```

**One artifact, not two**, because the situation the file exists for is a user finding it two
years later: one share action and one thing to keep track of beats two files that must stay
together to mean anything. `expo-sharing` also shares one file at a time, so the alternative was
two buttons. The accepted cost is that a `.zip` cannot be handed straight to Contacts.app — the
user unzips first, and `README.txt` is what keeps that from being confusing.

`README.txt` is not filler. It is the only part of the archive that explains itself to somebody
opening it long after the fact, and the only thing a future restore path can read if `data.json`
turns out to be unreadable.

`data.json` carries a `version` and a Zod schema **from the first commit**, while it holds nothing
else. Increment 1 already ships the file onto users' disks: adding fields to an identified file
later is ordinary, retrofitting a version onto one already in the wild is not.

`fflate` rather than `jszip`: ~8KB, pure JS, no native module, and it runs on the Hermes floor.
Deflate rather than store, because vCard is extremely compressible text and a large address book
is the case that matters. The zip's embedded timestamp comes from the injected instant, so two
exports of an unchanged store are the same file byte-for-byte.

## What it does not carry yet

Increment 1 is published people, their contact methods and their birthday. Pets, unpublished
people, the other nine milestone kinds and the relationship graph are increment 2; `data.json`'s
real contents are increment 3.

One consequence worth knowing while increment 5 is outstanding: **the parser cannot yet read back
the `UID`, `CATEGORIES` and `X-LEAPSAKE-*` this writes**, so re-importing our own file duplicates
everyone and loses those fields. Survivable only because mobile's import path reads device
Contacts and cannot open a `.vcf` at all — desktop's drag-drop *can*, so do not point a desktop
user at their own export until that lands.
