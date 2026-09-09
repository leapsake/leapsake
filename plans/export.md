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

> ✅ **Free, and already transitive** *(built, increment 1)*. This asked for an `includeDeleted`
> parameter on the read port; it turned out to be unnecessary. `@leapsake/data` bakes
> `deleted_at IS NULL` into `createEntityRepo`'s `listWhere`/`get` and into `tags.listForEntity`'s
> join, so **every read an exporter can make is already live-rows-only** and no query exists that
> could produce the dangling reference. Adding the parameter would be the thing that lets a future
> caller opt *into* the surprise. See [`../packages/export/README.md`](../packages/export/README.md).

## The property mapping

`RelationshipRole`, `MilestoneKind`, labels and platform ids are as
[`@leapsake/schema`](../packages/schema/README.md) spells them. **Read the "Reads it today" column
as the work estimate**: ✅ round-trips through `packages/vcard/src/vcard.ts` unchanged.

> ⚠️ **The column is about the *parser*. Everything below is now written**
> (`packages/vcard/src/write.ts`); the ❌s are what still cannot be read back, which is
> increment 5 and unchanged.

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
| any custom label | `itemN.<PROP>` + `itemN.X-ABLABEL:<label>` | ✅ `appleLabelText` |

**ADR component order is PO Box; Extended; Street; Locality; Region; Postal; Country** — `line1`
is the *street* slot and `line2` the *extended* slot, which is the inverse of how `mapAddress`
falls back when reading. Get this wrong and every address round-trips shifted by one field.

### Milestones

| Leapsake | vCard | Reads it today |
|---|---|---|
| `birthday` | `BDAY:1985-04-12`, or `BDAY:--0412` with no year — see *Writing dates* | ✅ `parseDateValue` |
| `anniversary` **and** the other eight kinds | `itemN.X-ABDATE:<date>` + `itemN.X-ABLABEL:<Kind>` | ⚠️ needs `DATE_KINDS` entries |
| ~~`ANNIVERSARY:<date>`~~ | **never written** — iOS ignores the property entirely (below) | ✅ still *read*, for other people's files |
| `milestones.note` | `X-ABDATE;X-LEAPSAKE-MILESTONE-NOTE=<note>` | ❌ new (param, so it rides the date) |
| `milestones.id` | `X-ABDATE;X-LEAPSAKE-MILESTONE-ID=<uuid>` | ❌ new |
| `milestones.kind` | `X-ABDATE;X-LEAPSAKE-MILESTONE-KIND=<kind>` | ❌ new |
| a milestone borne by a **relationship** | the same pair on **both** partners' cards, one `-ID`, plus `X-LEAPSAKE-MILESTONE-REL=<relationshipId>` | ❌ new |

**The `X-LEAPSAKE-*` here are parameters, not properties, and that is load-bearing.** An unknown
*parameter* is invisible to any parser; an unknown *property* lands in our own reader's `dropped`
list, so the property spelling would fill a user's re-import review with noise about their own
file. `X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED` are the only two facts with no property to ride,
and the parser's `DEFERRED` set is what keeps them quiet.

**A relationship-borne milestone is written twice on purpose.** A wedding belongs to the marriage,
not to either partner, so it goes on both cards carrying one `-ID` — the same shape `RELATED` uses,
and the reason an importer can tell one anniversary written twice from two anniversaries. A third
party that knows neither parameter still shows each partner their anniversary, which is the outcome
a user wants.

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
| `X-ABDATE:--0412` + `X-ABLABEL` | **an *Anniversary* field**, no year ✅ — the label survives |
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

**What licenses that** is the other half of the `X-ABDATE` probe: iOS filed those cards under an
*Anniversary* field, not a birthday, so **`X-ABLABEL` survives import and still names the date**.
That is the mechanism the other eight kinds ride on — `wedding`, `graduation`, `moved` and the
rest are the same pair with a different label — so the plan to carry all ten this way rests on a
measured fact rather than an assumption.

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
| `roleNote` on an `other` role | `TYPE=<note>`, **bare** | ✅ unmapped `TYPE` becomes the note |
| the exact role, all 41 of them | `RELATED;X-LEAPSAKE-ROLE=<role>` | ❌ new (param) |

**`TYPE` carries the role's `base`, and `X-LEAPSAKE-ROLE` the role itself.** Leapsake has 41 roles
and RFC 6350 gives us seven words, so `mother` goes out as `TYPE=parent` — what a standards
consumer can actually use — with `X-LEAPSAKE-ROLE=mother` beside it. Writing `TYPE=mother` instead
would tell a third party nothing *and* lose the kinship through our own parser, which has no entry
for it. A base with no RFC word (`cousin`, `classmate`, `pibling`, `owner`…) is written as itself.

**Bare, not `x-<note>`:** `relatedFrom` turns an unmapped `TYPE` into exactly the word it read, so
`TYPE=muse` round-trips to "muse" while `x-muse` round-trips to the literal string "x-muse".

An edge appears on **both** cards, which is what vCard means by `RELATED` and is not a duplicated
fact — `X-LEAPSAKE-REL-ID` is what lets an importer recognise the two halves as one edge.

### Pet card

`KIND:x-pet` (`KIND` accepts x-names, RFC 6350 §6.1.4), then `UID`, `FN`, `GENDER`, `CATEGORIES`,
its milestones, and a `RELATED` to its owner. `petSchema` is only `name` + `gender` + `standing`,
so there is nothing else to carry. `KIND` is in `STRUCTURAL` today, so reading it is new work.

> Apple Contacts will import a pet card as an ordinary person called "Rex". Accepted: nothing is
> lost, and our own importer gets it right.

## What is not person-shaped

✅ **Built** *(increment 3)* — the ten tables that belong to no single card go in `data.json`,
which duplicates nothing in the `.vcf`. Which tables, and the four places a row is *not* written
verbatim (tags by name, no catalog holidays, holiday choices by slug, no device facts), now live
next to the code: [`../packages/export/README.md`](../packages/export/README.md).

> iCalendar is the tempting standard here (reminders are `VTODO`s, holidays recurring `VEVENT`s)
> and is deliberately **not** v0.1: it is a second full format implementation, and `source`,
> `reminder_rules` and mentions would need `X-` properties inside it anyway.

## One file: the archive

✅ **Built** *(increment 1)* — a single `leapsake-export-<date>.zip` holding `contacts.vcf`,
`data.json` and `README.txt`. Why one artifact rather than two, why `fflate`, why `README.txt` is
not filler, and why the archive is written to Caches rather than documents now live next to the
code: [`../packages/export/README.md`](../packages/export/README.md).

## Increments

**4 is next, and is the one GA blocks on.** It was gated on 3 rather than on tidiness: it puts an
*Export first* button inside the two confirmations that destroy the only copy of somebody's data,
so it is the app making a formal promise at the one irreversible moment. While `data.json` was
`{"version": 1}` that promise would have handed the user a file with every reminder, gift idea,
holiday choice, `not_a_duplicate` judgment and notification setting missing, at exactly the moment
they could not check and could not undo — and **an incomplete backup offered there is worse than
no offer**, because they act on it. 3 has landed, so the offer is now honest.

> ✅ **1 and 2 are built** *(2026-09-07)* — the whole person graph. `@leapsake/vcard`'s
> serializer, the [`@leapsake/export`](../packages/export/README.md) package behind
> `core.export.archive()`, and an Export section on `app/data.tsx`. The durable *why* lives next
> to the code; what belongs here is the four calls that widened what this doc scoped, each
> recorded in its table above: writer-only `X-LEAPSAKE-*` **parameters** ship rather than waiting
> for a reader, since their absence makes a "backup" quietly lossy; a **relationship-borne
> milestone** is a case this doc never had a row for, and goes on both partners' cards; the exact
> **role** rides `X-LEAPSAKE-ROLE` beside a standard `TYPE`; and the milestone id/note became
> parameters rather than the properties the table first spelled.
>
> Two real bugs fell out of building them, both in the *importer*, both hit on every real Apple
> export rather than only on our own files:
>
> - `deriveName` duplicated a lone `FN` token into both name slots for a surname-only card.
> - **`X-ABLABEL` was read for dates and for nothing else**, so every custom contact-method label
>   on a card straight out of an iPhone — "Beach house", "Mum's place" — imported as "Other". The
>   grouped label now reaches `labelFrom`, which is also what lets the export write labels the way
>   Contacts does.
>
> Also learned: two desktop guards force a new `CoreApi` method to declare an IPC channel and a
> read/write classification. Increment 2 tripped neither — it changed the ports behind
> `export.archive`, not the method.

> ✅ **3 is built** *(2026-09-08)* — `data.json` holds the ten tables, and the format's *why* is
> in the package README. What belongs here is the three calls that widened what this doc scoped.
> The trap this increment was written around was real but **the fix generalised**: rather than
> three bespoke reads, `listActive()` went on `defineSyncable`, so every synced table now has a
> filtered whole-table read and `listChangedSince(0)` has a correct alternative to lose to. Tags
> on **gift ideas** turned out to be an eleventh table this doc's list missed — a `#tag` on a gift
> idea had nowhere to go, exactly like one on a reminder — so both travel, by name. And
> `counts.otherRecords` grew rather than staying at four numbers, because without it the half of
> the archive that is not contacts is invisible from outside the zip: the mobile result line, the
> `dev-export` harness and the Maestro assertion all read it.

4. **Wire the offer that already exists in the copy.** Unblocked now that 3 has landed — the
   archive holds everything, so offering it at the irreversible moment no longer promises more than
   the file delivers. An **Export first** button inside *both* destructive confirmations in
   `app/data.tsx` — `ForgetAccountSection` **and** `FactoryResetSection`. The accountless wipe is by
   definition destroying the only copy, so it needs the offer at least as much — which is what
   `key-custody/README.md`'s note already says. Then delete that note (rewritten in increment 1,
   and it says to delete it here).
   **Leave desktop's "Leapsake cannot export it yet" in `Settings.tsx` alone** — desktop still has
   no Export surface, so the sentence stays true until increment 6.
5. **The import-side reciprocals** (not GA-blocking, but they decide whether the file is readable
   back): `CATEGORIES` → tags, the nine new `DATE_KINDS` entries, `KIND:x-pet`, `REV`, `UID` out of
   `STRUCTURAL` so the deferred `RELATED` `urn:uuid:` second pass can land — the TODO on
   `relatedFrom` — the parser's `DEFERRED` set (`X-LEAPSAKE-SELF`, `-CREATED`), and every
   `X-LEAPSAKE-*` **parameter** increments 1 and 2 write: `EXT`, `COUNTRY`, `USERID`, `ROLE`,
   `REL-ID`, and `MILESTONE-ID`/`-KIND`/`-NOTE`/`-REL`. `DEFERRED` emptying out is the signal this
   has landed.

   Adding the `DATE_KINDS` entries **pays twice and costs twice**: the map is shared with the
   device importer, so an iOS contact labelled "Graduation" starts minting milestones in the same
   change. That is a user-visible behaviour change and wants its own tests. **Until this lands,
   re-importing our own file duplicates everyone, demotes every real relationship to an
   unpublished stub, and loses those fields.** Survivable on mobile only because the mobile import
   path reads device Contacts and cannot open a `.vcf` at all; desktop's drag-drop *can*.
   `packages/vcard/test/write.test.ts`'s `asParsedToday` helper is where the gap is written down —
   delete it when this lands.
6. **After GA:** restore, desktop parity, CardDAV.

`CATEGORIES` import (in 5) is contained, and is now smaller than this said: `ParsedContact`
**already carries `tags`** (increment 1 added it, along with `uid`, so the writer had somewhere to
read them from). What is left is the parser filling it, `ImportPorts` gaining `addTags`, and core
wiring that to the `tags.setEntityTags` it already calls from `people.create`. Increment 2 added
`kind`, `isSelf`, `createdAt`/`updatedAt`, and the id/note fields on `ParsedDate`/`ParsedRelated`
the same way — every one of them is a field the *reader* still fills with its absent value.

## Testing

✅ **The pure tiers are built**: `parseVCards(writeVCards(x)) ≡ x` plus the cases vCard is famous
for (`packages/vcard/test/write.test.ts`), the archive against fake ports
(`packages/export/test/archive.test.ts`), and `core.export.archive` over real repos
(`apps/desktop/test/integration/export-archive.test.ts` — the half that would otherwise fail
silently, since an export missing everybody's phone numbers is still a valid archive).

`data.json` is covered at both tiers the same way, and the integration one carries the assertion
worth keeping: **a soft-deleted row from each of the three tables with no entity repo is absent
from the file.** That is the test that would have caught `listChangedSince(0)`, which is the
mistake this half of the format was designed around. `entity-repo.test.ts` pins the difference
directly — `listActive()` and `listChangedSince(0)` answering differently on one table at one
moment.

The round trip cannot be literal while increment 5 is outstanding, and `asParsedToday` is the
**ledger of every gap**: what vanishes silently (`UID`, `KIND`, `REV`, the `DEFERRED` set), what
falls to `dropped` (`CATEGORIES`, a `urn:uuid:` `RELATED`, nine of the ten milestone kinds), and
how a role **degrades** (`mother` → `parent`; `cousin` → `other` + note). Each has a golden-text
test beside it, so nothing in the ledger is merely asserted.

✅ **Verified once on the simulator** *(2026-09-07)* — iPhone 16 Pro, iOS 26: the archive builds
**on Hermes** (which is what the Node tiers cannot speak to — `fflate` had never run there), lands
in `Library/Caches`, and opens with the system `unzip` as three members with valid vCard 4.0
inside. `app/dev-export.tsx` is the harness: `__DEV__`-gated, deep-link only
(`leapsake://dev-export`), it runs the export **on mount** and writes to a fixed path, because the
real button opens a share sheet no shell-driven harness can dismiss — there is no tap command for
the simulator.

✅ **Re-run for increment 2** *(2026-09-07, same simulator)* — the store held two people and a
`friend` edge between them, which is exactly the case increment 1 could not write. The diff
against increment 1's `.vcf` is the whole increment where that store touches it:

```
UID:urn:uuid:1cb7bbba-…
KIND:individual
FN:Augustus De Morgan
RELATED;VALUE=uri;TYPE=friend;X-LEAPSAKE-ROLE=friend;X-LEAPSAKE-REL-ID=5886
 f2e7-…:urn:uuid:6c987a68-…
X-LEAPSAKE-CREATED:2026-09-07T03:20:29Z
REV:2026-09-07T03:20:29Z
```

— the same `REL-ID` on both cards pointing at each other's `UID`, and the fold landing correctly
inside a `RELATED` well past 75 octets. `people=2 pets=0 methods=0`.

⚠️ **What that store could not exercise**, and which therefore rests on the Node tiers alone: a
pet card, an unpublished person as a text `RELATED`, a custom `X-ABLABEL`, and
`X-LEAPSAKE-SELF`. The Hermes-specific risk is covered — the graph walk and the writer run there —
but a store with a pet and an unpublished person is worth building by hand before GA.

✅ **Re-run for increment 3** *(2026-09-08, iPhone 16 Pro / iOS 26.5)* — this time the store was
built by **running the e2e arc first** (`pnpm test:e2e --platform=ios`, flows 1/2/3/5), which is a
better harness than seeding by hand: the rows come from the real screens. `data.json` went from 20
bytes to 4,149, and `dev-export-status` read `other=11`:

```
reminders = 3        one user reminder with tags ["birthday"], two system onboarding nudges
mentions = 1         → Ada Lovelace's person id, read through listActive()
reminderRules = 5    the milestone schedule flow 3 wrote
giftIdeas = 1        tags [], and its recipient link carrying givenAt from the ✓ tap
giftRecipients = 1
```

That covers the two mechanisms worth proving on Hermes: **`listActive()`** (the `mentions` row —
the method this increment added, on a table with no entity repo) and **tags resolved to names**
(`#birthday` in a reminder's body arriving as `tags: ["birthday"]`). The zip still unzips as three
members, and `README.txt` carries the widened `data.json` paragraph.

⚠️ **Zero on device, and therefore resting on the Node tiers alone:** holiday choices (so the
`holidaySlug` denormalization), `not_a_duplicate`, `relationship_dismissals` and
`notification_settings`. Each uses a mechanism one of the five above already proved — three read
through `list()`, two through `listActive()` — so the Hermes-specific risk is covered even where
the table is not. The integration tier asserts all of them against the real seeded catalog.

> Flow 4 (create an account) went RED on this run, at `assertVisible not "Protect my data"` after
> `account-submit`. **Unrelated to export** — it is the encryption-conversion flow, and 1/2/3/5
> all passed — but it is the state of `pnpm test:e2e` on `main` and wants its own look.

**Still owed: the device tier.** Maestro asserts the share sheet opened and that
`testID="export-result"` reports non-zero record and byte counts — the tap and the share itself
are the part still unproven. **No new rung in the catalog** —
[`testing/crucial-flows.md`](./testing/crucial-flows.md)'s table is settled policy. And once, by
hand: AirDrop a real export off the device, unzip it, and import `contacts.vcf` into macOS
Contacts — the round trip the *Writing dates* probes were measured against.

## Open

Nothing. Every question this doc opened has been answered — the last one, year-less dates, by
[measurement on a real iPhone](#-verified-on-a-real-iphone-owner-2026-09-07) rather than by
argument. What remains is building the increments.

> Two things to **re-test rather than re-reason** when the ground moves: `X-ABDATE` versus
> `ANNIVERSARY` when a non-Apple client ships (*Writing dates*), and whether Contacts still reads
> `--0412` after any iOS release that touches contact import. The fixtures for both are in
> [`../packages/vcard/test/fixtures/`](../packages/vcard/test/fixtures/).
