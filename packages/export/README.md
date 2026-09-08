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

The third is the interesting one, and today it needs no code here: `@leapsake/data` bakes
`deleted_at IS NULL` into `createEntityRepo`'s `listWhere` and `get`, and into
`tags.listForEntity`'s join, so **every read the current ports make is already live-rows-only**.
`plans/export.md` originally asked for an `includeDeleted` parameter to make this cheap to
revisit; it turned out to be unnecessary, and adding one would be the thing that lets a future
caller opt *into* the surprise.

⚠️ **That was a property of `createEntityRepo`, not of the data layer** — and `data.json` is where
it nearly broke. `mentions`, `not_a_duplicate` and `relationship_dismissals` have no entity repo,
and their one enumerating method was `listChangedSince(since)`: `WHERE updated_at > ?` with **no
`deleted_at` clause at all**, deliberately, because sync has to propagate tombstones.
`listChangedSince(0)` is the obvious way to dump a table and it is the bug — it would put deleted
rows in the one artifact that leaves the device.

They got a filtered read of their own instead: **`listActive()` on `defineSyncable`**, so it is
now true of *every* synced table rather than only the ones with an entity repo, and a new port has
something correct to reach for. Its doc-comment sits beside `listChangedSince`'s, which is where
somebody about to make this mistake is already reading. `apps/desktop/test/integration/entity-repo.test.ts`
asserts the two answer differently on the same table at the same moment.

`listPeople` and `listPets` likewise answer only **published** entities (`PUBLISHED_SQL`).
Somebody who exists only as a fact about another person belongs on that person's card as a
`RELATED`, not on a card of their own — see *The graph walk* below.

## The archive

```
leapsake-export-2026-09-07.zip
├── contacts.vcf   the person graph — people, pets, dates, relationships
├── data.json      everything not person-shaped (versioned)
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

`data.json` carried a `version` and a Zod schema **from the first commit**, while it still held
nothing else. Increment 1 already shipped the file onto users' disks: adding fields to an
identified file later is ordinary, retrofitting a version onto one already in the wild is not.
Filling it did not bump the version — every table is its own optional key, so a file written by an
older app still parses, and the version is left for a change of *shape*.

`fflate` rather than `jszip`: ~8KB, pure JS, no native module, and it runs on the Hermes floor.
Deflate rather than store, because vCard is extremely compressible text and a large address book
is the case that matters. The zip's embedded timestamp comes from the injected instant, so two
exports of an unchanged store are the same file byte-for-byte.

## The graph walk

Increment 1 could visit each person alone. Carrying relationships cannot: an **edge is a fact
about two entities** and lands on both their cards, so `buildArchive` is a graph walk rather than
a list. Three things follow, and each is the reason for a shape that would otherwise look odd.

**An unpublished person is reached only through somebody else's `neighborsFor`.** They never get a
card — that is what their standing means, so the file says exactly what the store does: a name on
the card of the one person they are a fact about. `listPeople` cannot see them, which is not a
limitation to route around but the invariant itself.

**A milestone borne by a *relationship* is written on both partners' cards, with one id.** A
wedding belongs to the marriage, not to either partner. Writing it once, on whichever card sorted
first, would show a third-party importer the anniversary on one of the two people and make which
one look arbitrary. Writing it twice needs the shared `X-LEAPSAKE-MILESTONE-ID`, or an importer
could not tell one anniversary written twice from two anniversaries — the same problem
`X-LEAPSAKE-REL-ID` solves for the edge itself, solved the same way. The read is memoised by
relationship id, so an edge visited from both ends costs one query.

**Derived edges are excluded twice over.** The kinship engine computes some neighbors live — your
parent's sibling is your pibling — and those have no stored row. Exporting one would write an
inference into the file as if the user had recorded it, and a re-import would then *store* it, at
which point it stops being live and starts being stale. `ExportPorts` says the implementation must
not return them, core wires `orientedNeighbors` (explicit by construction) rather than the kinship
service, and the builder filters again. Belt and braces on purpose: the failure is silent and
permanent.

## `data.json` — what the `.vcf` cannot hold

A vCard is a person. Reminders, gift ideas, holiday choices, duplicate judgments and notification
preferences belong to no single card, and appending them as fabricated `KIND:x-leapsake-*` records
would make Apple Contacts import somebody's reminders as human beings. So they go in a companion
file inside the same archive, which **duplicates nothing** in the `.vcf`.

It is the rows as `@leapsake/schema` spells them, with four deliberate departures. Each is a place
where writing the row verbatim would have been wrong:

**Tags travel by name.** A person's tags ride the `.vcf` as `CATEGORIES`; a reminder's and a gift
idea's have no card to ride, so without this a tag the user put on a reminder would vanish from
their backup silently. Names rather than ids for the same reason `CATEGORIES` uses them: they are
what a human reads, and a restore re-creates them through the same
`tags.setEntityTags(type, id, names)` every tag is already written with — so the file never has to
carry the `tags` and `taggings` tables and their ids at all.

**The holiday catalog does not travel.** It is read-only and the app reseeds it, so shipping it
would bloat every archive with data that regenerates itself. A holiday the *user* authored has no
other copy anywhere, so that goes out whole.

**A holiday choice travels by slug.** An observance's `holidayId` is
`deterministicUuid(HOLIDAY_NAMESPACE, slug)`, so the two agree by construction — but only the slug
is legible, and it is the key `ux_holidays_slug_active` makes stable. Null where the holiday row
itself is gone: honest, rather than dropping the observance and losing the user's answer with it.

**A device's own facts do not travel.** Notification *preferences* do — mode, delivery time, the
label the user typed. `permissionState` and `platform` do not: they are what one phone's OS last
answered, and restoring "notifications allowed" onto a new device would be a lie the app then acts
on.

`counts.otherRecords` is the total, and it exists because it has a reader: the line the app shows
after a share. Without it the half of the archive that is not contacts is invisible from outside
the zip, and neither the user nor the on-device harness can tell a backup that carries their
reminders from one that silently does not.

## What it does not carry yet

One consequence worth knowing while increment 5 is outstanding: **the parser cannot yet read back
most of what this writes** — `UID`, `CATEGORIES`, `KIND`, `REV`, and every `X-LEAPSAKE-*` — so
re-importing our own file duplicates everyone, demotes every published relationship to a dropped
field, and loses those fields. Survivable only because mobile's import path reads device Contacts
and cannot open a `.vcf` at all; desktop's drag-drop *can*, so do not point a desktop user at
their own export until that lands.
