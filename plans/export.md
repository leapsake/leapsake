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
as the work estimate**: ✅ round-trips through `packages/contact-import/src/vcard.ts` unchanged.

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
| `birthday` | `BDAY:YYYY-MM-DD`, or `--MM-DD` with no year | ✅ `parseDateValue` |
| `anniversary` | `ANNIVERSARY:<date>` | ✅ |
| the other eight kinds | `itemN.X-ABDATE:<date>` + `itemN.X-ABLABEL:<Kind>` | ⚠️ needs `DATE_KINDS` entries |
| `milestones.note` | `itemN.X-LEAPSAKE-MILESTONE-NOTE:<note>` | ❌ new |
| `milestones.id` | `itemN.X-LEAPSAKE-MILESTONE-ID:<uuid>` | ❌ new |

`DATE_KINDS` in `apple-labels.ts` maps exactly one label today (`anniversary`), so `wedding`,
`death`, `first-date`, `met`, `graduation`, `job-start`, `moved` and `other` have no way back in.
**Adding them pays twice**: that map is shared with the device importer, so the iOS Contacts path
gains the same kinds in the same change.

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
make Apple import your reminders as contacts. They go in a **companion file**
(`leapsake-data-<date>.json`), which duplicates nothing in the `.vcf`:

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

## Increments

Each is shippable alone. **1, 2 and 4 are what GA blocks on**; 3 is what makes the file a backup
rather than a contacts dump, and is cheap once 1 exists.

1. **The writer, and a file that leaves the device.** `vcard.ts` gains a serializer — fold at 75
   octets, escape, param quoting — beside the parser it inverts, and `expo-sharing` +
   `expo-file-system` carry the result to the share sheet. Write to the **cache** directory, not
   documents (Caches is excluded from device backup, so a plaintext dump never rides along in one),
   and delete on dismiss. Person cards with names, contact methods, birthday, `UID`, `CATEGORIES`.
   *Done when:* a user with no account taps Export on `app/data.tsx` and gets a `.vcf` they can save.
2. **The rest of the person graph.** Pets, unpublished people via `RELATED`, all ten milestone
   kinds, relationships, custom labels, the `X-LEAPSAKE-*` fields above.
3. **The companion file** — everything in *What is not person-shaped*, versioned and schema'd.
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
argument for keeping the writer in the same package as the reader. Cover the cases vCard is famous
for: a `;` or `,` in a name, non-ASCII, a fold landing mid-UTF-8-sequence, an empty structured
component, a 300-character note.

On device, keep it cheap: Maestro asserts the share sheet opened and a `testID` reporting record
and byte counts. If a real assertion is wanted, add a dev route in the style of
`app/dev-clear-dbkey.tsx` that writes to a known path for an out-of-band check. **No new rung in
the catalog** — [`testing/crucial-flows.md`](./testing/crucial-flows.md)'s table is settled policy.

## Open

1. **Year-less dates: `--MM-DD` or Apple's placeholder?** RFC 6350 spells it `--MM-DD`; Apple
   Contacts writes a placeholder year plus `X-APPLE-OMIT-YEAR` and may not read the standard form.
   The parser handles both. **Leaning `--MM-DD`** — it is the standard, and the interop cost falls
   on one app rather than on the format. Decide before increment 1 writes a birthday.
2. **Does the package get renamed?** `@leapsake/contact-import` will hold an exporter. `vcard` or
   `contacts-interop`. Pre-v0.1, a rename is cheaper than a lying name.
3. **One artifact or two?** Increments 1 and 3 produce two files, and `expo-sharing` shares one at
   a time. Two buttons, or a `.zip` (pure-JS, no native module). Two buttons is simpler and keeps
   the `.vcf` directly usable by another app; revisit if it reads as clutter.
