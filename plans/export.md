# Export

> **Getting a user's data out of the app, on iOS.** [`shipping.md`](./shipping.md) → Part 1,
> step 1 holds the *why* and the acceptance; this holds the format and the increments.
> **Delete each increment as it lands, and the file when the last one does.**

⚠️ **It must not use iCloud.** No entitlement, ever — see `shipping.md`. What that forbids is
`com.apple.developer.icloud-*` in a shipped build. It does **not** forbid the user choosing
iCloud Drive from the system share sheet, which is their act through `UIDocumentPickerViewController`
and needs nothing from us. `apps/mobile/app.json` stays clean; `expo-sharing` adds no entitlement.

## The shape, decided

**One family of files, no fact written twice.** Where a standard property exists we use it; where
none does we use a custom property rather than a second serialization of the same record. So there
is no "vCard *and* a JSON dump of the same people" — the `.vcf` is the person graph, whole.

Four calls, settled 2026-09-07:

1. **Custom properties are `X-LEAPSAKE-*`** (RFC 6350 §6.10), plus three other extension points the
   format already blesses: x-name `TYPE` params, `KIND` with an x-name, and Apple's
   `itemN.` group + `X-ABLABEL` convention that `vcard.ts` already parses. `PRODID` identifies the
   writer so an importer can detect the dialect before trusting it.
2. **Unpublished people ride on the card of the person they hang off**, as `RELATED` with a text
   value. Not their own card. Their gender is not carried — accepted as a loss.
3. **Pets get a card**, `KIND:x-pet`.
4. **Soft-deleted rows are excluded.** An export is a snapshot of what the app holds.

**Why 2 is exact rather than approximate:** an unpublished entity has exactly one edge (a second
one promotes it — core's `createFromSubject`), so there is always exactly one card to hang it off
and never a question of which. `ingest.ts`'s `addRelated` already builds these in the opposite
direction, so the exporter is the mirror of shipped code.

**Why 4:** tombstones here are a sync mechanism, not a recycle bin — `petSchema` says so in as many
words, and there is no undelete UI for a person or a pet anywhere in the tree. The export is also
the **one artifact that leaves the device**, so shipping rows the user told the app to forget is a
privacy surprise in the one place we cannot take it back. And it does not even round-trip: vCard
cannot say "deleted", so every third-party import would resurrect them as live contacts.
**Keep it cheap to revisit** — one `includeDeleted` parameter on the read port, defaulted `false`,
not `WHERE deleted_at IS NULL` spread across a dozen queries.

> **The exclusion has to be transitive.** Dropping a deleted person while keeping a relationship,
> mention, tagging, observance or gift recipient that points at them yields a dangling reference.
> One "live rows only" read layer, not a predicate per query.

## The property mapping

`RelationshipRole`, `MilestoneKind`, labels and platform ids are as
[`@leapsake/schema`](../packages/schema/README.md) spells them. **Read the "Reads it today" column
as the work estimate**: ✅ round-trips through `packages/vcard/src/vcard.ts` unchanged.

### Person card

| Leapsake | vCard | Reads it today |
|---|---|---|
| `people.id` | `UID:urn:uuid:<id>` | ❌ in `STRUCTURAL`, ignored — increment 5 |
| first / middle / last | `N:<last>;<first>;<middle>;;` | ✅ `deriveName` |
| display name | `FN:<composed>` | ✅ required by RFC 6350 |
| `gender` | `GENDER:M`/`F`/`O`/`N`/`U` | ✅ `parseGender` |
| tags (via `taggings`) | `CATEGORIES:Family,Work` | ❌ dropped today — increment 5 |
| `self_person` | `X-LEAPSAKE-SELF:TRUE` | ❌ new |
| `updatedAt` | `REV:<ISO 8601 UTC>` | ✅ ignored as structural |
| `createdAt` | `X-LEAPSAKE-CREATED:<ISO>` | ❌ new |
| `standing` | never written — an unpublished person is a `RELATED` on another card | — |

### Contact methods

| Leapsake | vCard | Reads it today |
|---|---|---|
| `email_addresses` | `EMAIL;TYPE=<label>:<address>` | ✅ `emailLabel` |
| `phone_numbers` | `TEL;TYPE=<label>:<number>` | ✅ `phoneLabel` |
| `phone_numbers.smsCapable = false` | add `TYPE=FAX` | ✅ read as the inverse |
| `phone_numbers.extension` | `TEL;X-LEAPSAKE-EXT=<ext>` | ❌ new (param, so it rides the `TEL`) |
| `phone_numbers.country` | `TEL;X-LEAPSAKE-COUNTRY=<ISO>` | ❌ new; parser sets `country: null` today |
| `postal_addresses` | `ADR;TYPE=<label>:;<line2>;<line1>;<locality>;<region>;<postalCode>;<country>` | ✅ `mapAddress` |
| `postal_addresses.country` (ISO) | `itemN.X-ABADR:<cc>` beside the `ADR` | ✅ `countryCode`'s hint |
| `social_profiles` | `X-SOCIALPROFILE;X-SERVICE-TYPE=<platform>:<url or handle>` | ✅ `socialFrom` |
| `social_profiles.platformUserId` | `X-SOCIALPROFILE;X-LEAPSAKE-USERID=<id>` | ❌ new |
| any `label_note` (custom label) | `itemN.<PROP>` + `itemN.X-ABLABEL:<note>` | ✅ `appleLabelText` |

**ADR component order is PO Box; Extended; Street; Locality; Region; Postal; Country** — `line1`
is the *street* slot and `line2` the *extended* slot, which is the inverse of how `mapAddress`
falls back when reading. Get this wrong and every address round-trips shifted by one field.

### Milestones

| Leapsake | vCard | Reads it today |
|---|---|---|
| `birthday` | `BDAY:1985-04-12`, or `BDAY:--0412` with no year — see *Writing dates* | ✅ `parseDateValue` |
| `anniversary` **and** the other eight kinds | `itemN.X-ABDATE:<date>` + `itemN.X-ABLABEL:<Kind>` | ⚠️ needs `DATE_KINDS` entries |
| ~~`ANNIVERSARY:<date>`~~ | **never written** — iOS ignores the property entirely (below) | ✅ still *read*, for other people's files |
| `milestones.note` | `itemN.X-LEAPSAKE-MILESTONE-NOTE:<note>` | ❌ new |
| `milestones.id` | `itemN.X-LEAPSAKE-MILESTONE-ID:<uuid>` | ❌ new |

`DATE_KINDS` in `apple-labels.ts` maps exactly one label today (`anniversary`), so `wedding`,
`death`, `first-date`, `met`, `graduation`, `job-start`, `moved` and `other` have no way back in.
**Adding them pays twice**: that map is shared with the device importer, so the iOS Contacts path
gains the same kinds in the same change.

#### Writing dates

`parsePartialDate` reads basic `19920309`, extended `1992-03-09`, year-less `--0309` / `--03-09`,
and year-only `1992`; `parseDateValue` separately unwinds Apple's `X-APPLE-OMIT-YEAR`. **Both
candidate spellings round-trip through us**, so our own fidelity does not decide this. What decides
it is what a *third party* does with the file, and the two failure modes are not symmetric:

| We write | A consumer that understands it | A consumer that does not |
|---|---|---|
| `BDAY:--0412` | April 12, no year | birthday **missing** |
| `BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-12` | April 12, no year | **person born in 1604** |

One loses data visibly; the other invents data silently and syncs it onward attached to a real
person. **This codebase has already made that judgment** — `parseDateValue`'s own comment calls the
1604 outcome "silently wrong, which is worse than … merely losing the year" — and has been bitten
from the other end too: `device-contacts.ts`'s `datePart` exists because a year-less anniversary
arrives from `expo-contacts` as `NSDateComponentUndefined` and used to fail the whole contact.

So: **`--0412`**, and not `--04-12` — RFC 6350's ABNF is `"--" month [day]` with no separator, so
the basic form is the one a strict parser accepts and a lenient one accepts anyway. **Full dates
stay extended (`1985-04-12`)**: Apple emits that form itself, so the ecosystem has proven it, and
it is the readable form for a human who opens the backup in a text editor. Same spelling for
`X-ABDATE`, even though it is Apple's own property.

> **Make it a test that the writer never emits a placeholder year.** That is exactly what a
> well-meaning "improve Apple compatibility" change reintroduces later.

##### ✅ Verified on a real iPhone *(owner, 2026-09-07)*

16 probe cards, both vCard versions, imported into iOS Contacts. Fixtures kept at
[`../packages/vcard/test/fixtures/`](../packages/vcard/test/fixtures/) — re-run them against a
device before trusting any of this again.

| Probe | iOS Contacts result |
|---|---|
| `BDAY:1985-04-12` / `BDAY:19850412` | full date ✅ — both full-date spellings work |
| **`BDAY:--0412`** | **April 12, no year ✅** |
| `BDAY:--04-12` | April 12, no year ✅ — iOS is lenient about the separator |
| `BDAY;X-APPLE-OMIT-YEAR=1604:…` | April 12, no year ✅ |
| `X-ABDATE:--0412` + `X-ABLABEL` | date, no year ✅ |
| **`ANNIVERSARY:--0412`** and **`ANNIVERSARY:1985-04-12`** | **nothing — the field never appears ❌** |

**The tradeoff was hypothetical: `--0412` simply works.** No user-facing format choice is needed,
and the `dateStyle` parameter is now a hedge rather than a requirement. **vCard version made no
difference** to any date, so 4.0 is a free choice.

**But `ANNIVERSARY` is dead on arrival**, and that is a plan change, not a detail. Both probes
failed — including one carrying a perfectly ordinary full date — so this is not a date-format
problem: **iOS does not read the property at all.** Writing an anniversary the standards-correct
way silently loses it on the one platform v0.1 ships to. So **every dated milestone including
`anniversary` goes out as `X-ABDATE` + `X-ABLABEL`**, and `ANNIVERSARY` is read-only vocabulary —
we accept it from other people's files and never emit it.

Note the shape of that: the two axes point opposite ways, and only evidence separates them. For
**how to spell a date**, the standard wins outright. For **which property carries an anniversary**,
Apple's extension wins outright. There is no "prefer the standard" rule that survives both.

> **The residual risk moves rather than disappearing.** A non-Apple consumer that reads
> `ANNIVERSARY` but not `X-ABDATE` now loses anniversaries. Writing both would double them up on
> anything that reads both, so it is one or the other. `X-ABDATE` is right while v0.1 is iOS-only;
> re-open this when a second platform ships, and test rather than reason about it.

### Relationships

| Case | vCard | Reads it today |
|---|---|---|
| published ↔ **unpublished** | `RELATED;VALUE=text;TYPE=<role>:<name>` | ✅ `relatedFrom` → an unpublished stub |
| published ↔ **published** | `RELATED;VALUE=uri;TYPE=<role>;X-LEAPSAKE-REL-ID=<id>:urn:uuid:<other>` | ❌ falls to `dropped` — increment 5 |
| `roleNote` on an `other` role | `TYPE=x-<note>` | ✅ unmapped `TYPE` becomes the note |

An edge appears on **both** cards, which is what vCard means by `RELATED` and is not a duplicated
fact — `X-LEAPSAKE-REL-ID` is what lets an importer recognise the two halves as one edge.

### Pet card

`KIND:x-pet` (`KIND` accepts x-names, RFC 6350 §6.1.4), then `UID`, `FN`, `GENDER`, `CATEGORIES`,
its milestones, and a `RELATED` to its owner. `petSchema` is only `name` + `gender` + `standing`,
so there is nothing else to carry. `KIND` is in `STRUCTURAL` today, so reading it is new work.

> Apple Contacts will import a pet card as an ordinary person called "Rex". Accepted: nothing is
> lost, and our own importer gets it right.

## What is not person-shaped

These belong to no single card, and appending them as fabricated `KIND:x-leapsake-*` records would
make Apple import your reminders as contacts. They go in a **companion file** (`data.json`), which
duplicates nothing in the `.vcf`:

- `reminders` (+ `mentions`, its taggings) and `reminder_rules`
- `gift_ideas` + `gift_recipients`
- `observances` and `hidden_holidays` — the user's *choices*
- `not_a_duplicate` — a judgment the user made that is expensive to re-make and invisible once gone
- `relationship_dismissals`
- `notification_settings` — preferences only; `permission_state` and `platform` are device facts

**Holidays reference the catalog by `slug`, and only `origin: "user"` rows are written whole.**
Catalog rows are read-only and reseeded by the app, so exporting all of them would bloat the file
with data that regenerates itself. `ux_holidays_slug_active` makes the slug the stable key.

Give the file a `version` and a Zod schema from the first commit — it is what a restore path reads.

> iCalendar is the tempting standard here (reminders are `VTODO`s, holidays recurring `VEVENT`s)
> and is deliberately **not** v0.1: it is a second full format implementation, and `source`,
> `reminder_rules` and mentions would need `X-` properties inside it anyway.

## One file: the archive

**The export is a single `leapsake-export-<date>.zip`** *(owner, 2026-09-07)*, holding:

```
contacts.vcf   the person graph
data.json      everything not person-shaped
README.txt     what these are, what wrote them, how to get them back
```

One artifact means one share action and one thing for a user to keep track of two years from now,
which is the situation the file exists for. `expo-sharing` shares one file at a time anyway, so
the alternative was two buttons.

**Use `fflate`, not `jszip`** — ~8KB, pure JS, no native module, and it runs on the Hermes floor
([`../packages/README.md`](../packages/README.md)). Deflate rather than store: vCard text is
extremely compressible, and a large address book is the case that matters. `zipSync` is fine at
these sizes; the whole archive is built in memory and handed to `File.write()` as a `Uint8Array`.

**`README.txt` is not filler.** It is the only part of the archive that explains itself to someone
opening it long after the fact — name the two files, say the `.vcf` imports into any contacts app,
say the `.json` needs Leapsake, and stamp the app version that wrote it.

> **Accepted cost:** a `.zip` cannot be handed straight to Contacts.app — the user unzips first.
> That is the price of one artifact, and `README.txt` is what keeps it from being confusing.

## Increments

Each is shippable alone. **1, 2 and 4 are what GA blocks on**; 3 is what makes the file a backup
rather than a contacts dump, and is cheap once 1 exists.

1. **The writer, and a file that leaves the device.** `@leapsake/vcard` gains a serializer — fold
   at 75 octets, escape, param quoting — beside the parser it inverts; `fflate` builds the archive
   and `expo-sharing` + `expo-file-system` carry it to the share sheet. Write to the **cache**
   directory, not documents (Caches is excluded from device backup, so a plaintext dump never rides
   along in one), and delete on dismiss. Person cards with names, contact methods, birthday, `UID`,
   `CATEGORIES`; `README.txt` alongside, `data.json` still empty at this point.
   *Done when:* a user with no account taps Export on `app/data.tsx` and gets a `.zip` they can save.
2. **The rest of the person graph.** Pets, unpublished people via `RELATED`, all ten milestone
   kinds, relationships, custom labels, the `X-LEAPSAKE-*` fields above.
3. **`data.json`** — everything in *What is not person-shaped*, versioned and schema'd.
4. **Wire the offer that already exists in the copy.** An **Export first** button inside *both*
   destructive confirmations in `app/data.tsx` — `ForgetAccountSection` **and**
   `FactoryResetSection`. The accountless wipe is by definition destroying the only copy, so it
   needs the offer at least as much; `key-custody/README.md` currently promises it only for the
   first. Then delete that README's "has had nothing behind it" note, and desktop's
   "Leapsake cannot export it yet" in `Settings.tsx`.
5. **The import-side reciprocals** (not GA-blocking, but they decide whether the file is readable
   back): `CATEGORIES` → tags, the new `DATE_KINDS` entries, `KIND:x-pet`, and `UID` out of
   `STRUCTURAL` so the deferred `RELATED` `urn:uuid:` second pass can land — the TODO on
   `relatedFrom`. **Until this lands, re-importing our own file duplicates everyone and demotes
   every real relationship to an unpublished stub.** Survivable on mobile only because the mobile
   import path reads device Contacts and cannot open a `.vcf` at all; desktop's drag-drop *can*.
6. **After GA:** restore, desktop parity, CardDAV.

`CATEGORIES` import (in 5) is contained: `ParsedContact` gains `tags`, the parser reads the
property, `ImportPorts` gains `addTags`, and core wires it to the `tags.setEntityTags` it already
calls from `people.create`.

## Testing

The serializer is pure, so the load-bearing test is **`parseVCards(write(x)) ≡ x`** — which is the
argument that settled the package name. Cover the cases vCard is famous
for: a `;` or `,` in a name, non-ASCII, a fold landing mid-UTF-8-sequence, an empty structured
component, a 300-character note.

On device, keep it cheap: Maestro asserts the share sheet opened and a `testID` reporting record
and byte counts. If a real assertion is wanted, add a dev route in the style of
`app/dev-clear-dbkey.tsx` that writes to a known path for an out-of-band check. **No new rung in
the catalog** — [`testing/crucial-flows.md`](./testing/crucial-flows.md)'s table is settled policy.

## Open

Nothing. Every question this doc opened has been answered — the last one, year-less dates, by
[measurement on a real iPhone](#-verified-on-a-real-iphone-owner-2026-09-07) rather than by
argument. What remains is building the increments.

> Two things to **re-test rather than re-reason** when the ground moves: `X-ABDATE` versus
> `ANNIVERSARY` when a non-Apple client ships (*Writing dates*), and whether Contacts still reads
> `--0412` after any iOS release that touches contact import. The fixtures for both are in
> [`../packages/vcard/test/fixtures/`](../packages/vcard/test/fixtures/).
