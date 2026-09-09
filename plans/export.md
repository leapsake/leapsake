# Export — what is left

> **Only the unbuilt half.** The exporter shipped in four increments over 2026-09-07/08 and a user
> can save their whole store as a `.zip`; **GA does not block on any code here.** Increment 5 — the
> whole import side — landed 2026-09-08 (5a–5d). What remains is **6** and three verifications. The
> format, the decisions behind it and the evidence for them live next to the code that has to obey
> them — see below.
> **Delete this file when 6 lands.**

## Where the built half is documented

Nothing about the shipped exporter is recorded here any more; it was duplicating its own code's
headers. Look in these places instead, in roughly this order:

| Question | Answer lives in |
|---|---|
| What does the writer emit, and why that spelling? | [`../packages/vcard/README.md`](../packages/vcard/README.md), then `src/write.ts` |
| Why `--0412` and not a placeholder year; why `X-ABDATE` and not `ANNIVERSARY` | `vcard/README.md` → *Two rules that point in opposite directions* — **measured on a real iPhone**, with the fixtures beside it |
| What is in the archive, why one file, why `Library/Caches` | [`../packages/export/README.md`](../packages/export/README.md) |
| What `data.json` holds, and the four places a row is not written verbatim | `export/README.md` |
| Why soft-deleted rows are excluded, and why that is free | `export/README.md` |
| How the app runs an export and cleans up after it | `apps/mobile/lib/export-share.ts` |

⚠️ **The one constraint that outlives this file: it must not use iCloud** —
[`shipping.md`](./shipping.md) holds it, permanently, and it binds increment 6 as much as it bound
1–4.

## 5 — The import-side reciprocals ✅ *(all four landed 2026-09-08)*

**It decided whether the file is readable back**, and it now is: `writeVCards` builds the whole
person graph and the parser has caught up with every part of it. What made it worth finishing was
desktop's drag-drop (`apps/desktop/src/renderer/src/App.tsx`), which *can* open a `.vcf` — so an
unread field was a real trap for a desktop user pointed at their own backup.

**The four files.** The reader is `packages/vcard/src/vcard.ts` (`STRUCTURAL`, `relatedFrom`,
`buildContact`); the label maps are `src/apple-labels.ts`; the write side that already emits all
this is `src/write.ts`; and `ImportPorts` — what core must implement — is `src/ingest.ts`. Core
wires it at `packages/core/src/index.ts` → `import.preview` / `import.commit`.

⚠️ **The ids in the file are matching keys, not row ids.** An imported card always gets a fresh
id, and `X-LEAPSAKE-CREATED` is parsed but never applied — no `create` input accepts a `createdAt`,
so honouring it means the row-level `insert`, which *is* the restore door. Writing the file's own
ids and timestamps back is increment 6, and none of 5a–5d let it in by the back door. 5c holds the
line for milestones: `X-LEAPSAKE-MILESTONE-ID` is a dedupe key and `-REL` is looked up through
a map, so neither is ever written as a row id.

### 5a — card identity ✅ *(shipped 2026-09-08)*

`UID`, `KIND`, `REV`, `CATEGORIES`, `X-LEAPSAKE-SELF`/`-CREATED`, and the `-EXT`/`-COUNTRY`/
`-USERID` parameters. `ImportPorts` gained `createPet`, `addTags` and `setSelf`; `import.preview`
gained `alreadyStored`, which is what stops a re-import quietly making a second copy of everyone;
the review surfaces that and offers the self claim **opted out**, so somebody else's export can
never take over the `self_person` pointer. The parser's `DEFERRED` set is gone, as its own doc
comment promised. `git log` has the rest.

### 5b — the relationship graph ✅ *(shipped 2026-09-08)*

`X-LEAPSAKE-ROLE` and `-REL-ID`, and a `RELATED` naming another card by `urn:uuid:` — the TODO on
`relatedFrom`, now gone. `parseVCards` indexes every card's UID before building any of them, so a
reference resolves whichever order the two cards arrive in, taking its name from the referenced
card's `FN`. `ingestContacts` is now two-phase: entities first, each still in its own transaction,
then the cross-card edges, written **once each** — `-REL-ID` is the dedupe key, which is what it
was always for. An edge whose other card the user skipped degrades to an unpublished stub rather
than vanishing, since the fact is true either way. Reading `-ROLE` ended the `mother`→`parent` /
`cousin`→`other` degradation.

> ⚠️ **It also fixed a regression 5a introduced.** Routing pets through `addRelated`, which
> hardcoded `aType: "person"`, made `holderAllows` refuse the row and fail the **whole pet card** —
> and our own exporter writes exactly that card for a pet with an unpublished owner. The port now
> carries the owner's entity type.

### 5c — the milestones ✅ *(shipped 2026-09-08)*

`X-LEAPSAKE-MILESTONE-KIND`/`-ID`/`-NOTE`/`-REL`. With the kind read, **our own file needs no label
guessing at all** — which is what leaves `DATE_KINDS` (5d) about other people's cards alone. The
parameter had to win *ahead* of the `X-ABDATE`-labelled-"Birthday" short-circuit, or a store
holding two birthday-kind milestones lost the second to the card's own `BDAY`; the branch below it
is the foreign-card rule and is untouched, so an iPhone card that spells its birthday twice still
collapses to one.

Below the parser, where the larger half was: `addBirthday`/`addDate` now take the bearer's **type**
alongside its id, and `linkExisting` returns the row it created, so phase 2 can build the
file-id→new-id map a relationship-borne milestone must be looked up through. `ingestContacts` grew
a phase 2b — edges first, then the milestones that hang off them, deduped on `-ID` so importing a
couple gives them one wedding rather than two.

> 🐞 **It also closed a latent hole 5b left.** Both phases' deferred work was pushed *inside* the
> contact's transaction, so a card that rolled back **after** setting an edge aside left phase 2
> holding an `ownerId` from an aborted transaction — an id naming no row. Everything is now held
> locally and appended only once the transaction commits, which is the rule `byUid` already
> followed.

> 🐞 **It fixed the live bug in the two ports it rewrote.** `addBirthday`/`addDate` had been reached
> by *pets* since 5a and both hardcoded `bearerType: "person"`. Unlike the `addRelated` bug 5b
> fixed, this one never threw — `kindAllowsBearer("birthday", "person")` is true, the row committed,
> and `listForBearer("pet", petId)` then returned nothing. Our own exporter writes exactly that
> card. The integration test asserts the read that proves it.

**Three judgment calls, none of them forced by the format:**

- **A milestone whose edge degraded lands on the person, not on the stub.** When the user skips one
  half of a couple, 5b keeps the relationship by inventing an unpublished spouse. Binding the
  wedding to *that* edge would say the marriage survived the skip, when what survived is only a
  name. It goes on whoever did import, where it can be rebound. (`addRelated` therefore still
  returns `void`; only `linkExisting` returns an id.)
- **A kind its bearer may not hold is skipped and reported, never thrown.** `kindAllowsBearer`
  permits a relationship to hold only `first-date`, `wedding`, `anniversary`, `met` and `other`,
  and a pet cannot hold an `anniversary` at all. Once the type travels, letting the row be refused
  would fail the *whole card* — the 5b failure shape. One milestone is dropped with an error
  against the card instead.
- **An `other` kind recovers its note from the label — except the bare word "Other".** The writer
  omits `-NOTE` when it equals the label, which is what it means on that kind; the parser puts it
  back, so the round trip is exact. But "Other" is how a *note-less* `other` is written, and
  reading that back as free text would invent a note the user never typed.

### 5d — `DATE_KINDS`, a foreign card's date label ✅ *(shipped 2026-09-08)*

The last of the four, and the one that mattered only for cards **we did not write**: since 5c reads
`-MILESTONE-KIND`, our own file needs no label guessing at all. Eight of the ten kinds are now
recoverable from a label alone. `birthday` and `other` are excluded permanently, for two unrelated
reasons the map's own comment states — a birthday-labelled date fills the contact's birthday rather
than minting a second one, and `other`'s label *is* the user's note, which no map could resolve.

**It paid twice, as predicted.** The map is shared with the device importer
(`apps/mobile/lib/device-contacts.ts`), so an iOS contact labelled "Graduation" or "Started a job"
started minting milestones in the same change — deliberately, since a rule living in only one of
the two importers is the bug `apple-labels.ts` exists to prevent. Both halves have their own tests.

**The two-test ledger held exactly.** Widening the map before touching any test failed precisely
the two that assert a label has no kind, and nothing else in 306; the broader run afterwards was
green across 2021 tests in `packages`, `apps/desktop` and `apps/server`.

> ⚠️ **Two judgment calls that are not what this file originally described.**
>
> - **The map is derived from `kindDefs`, not transcribed.** The plan here specified eight
>   hand-written string keys, and warned that they are the lower-cased *label* — `"started a job"`,
>   not `job-start`. Deriving them from `kindDefs[kind].label` makes that structural instead of a
>   comment, and closes a real hole: the writer emits that same label, so a reworded label would
>   otherwise have silently stopped matching with no test to catch it. The exclusions live in
>   `FROM_A_LABEL`, a `Record<MilestoneKind, boolean>` that is **exhaustive by type** — an eleventh
>   milestone kind now fails the build until somebody decides whether a stranger's card may mint it,
>   rather than widening the importer as a side effect of adding a kind to `@leapsake/schema`.
> - **"Beach house closing" replaced "Graduation" as the dropped-label example**, in four doc
>   comments and both READMEs. Graduation *became* a kind, so every comment using it to illustrate
>   a dropped label became false in the same change. An `other`-shaped label is the only example
>   that stays correct however wide the map grows, and the writer already used that exact phrase.

The rule the increment was warned not to reverse is intact: a label with no kind is still surfaced
as dropped and *named*, never guessed into `other`.

## 6 — After GA

Restore, desktop parity, CardDAV. Desktop's *"Leapsake cannot export it yet"* in `Settings.tsx`
stays true until the parity half lands, and `api-channels.ts` already carries the
`export.archive` channel waiting for it.

## Still owed: the device tier

The pure tiers are built and green, and the archive has been driven by hand on a simulator for
each increment. Three things are still owed, none of them blocking:

1. **The automated tap.** Maestro tapping Export and asserting the result line reports non-zero
   record and byte counts. `subflows/factory-reset.yaml` asserts the *offer is visible* in each
   destructive confirmation, but never taps it — deliberately, because a share sheet that fails to
   dismiss inside the teardown stalls the arc and leaves the next flow asserting against the
   previous one's store, which is that file's oldest and worst failure mode. **It wants a home
   where a stall fails loudly instead.**
   > **The dismissal is known to be drivable**, which was the part that looked hardest:
   > `tapOn: {point: "50%,15%"}` above the sheet closes it and lets `shareAsync` resolve. That is
   > how the by-hand run got its result line on 2026-09-08.
2. **One AirDrop round trip, by hand.** Take a real export off a device, unzip it, and import
   `contacts.vcf` into macOS Contacts — the round trip the date probes were measured against, and
   the only check that exercises a third-party consumer rather than our own reader.
3. **A store with a pet and an unpublished person.** No device run has held either, so a pet card,
   an unpublished person as a text `RELATED`, a custom `X-ABLABEL` and `X-LEAPSAKE-SELF` rest on
   the Node tiers alone. Worth building by hand before GA. The Hermes-specific risk is covered —
   the graph walk and the writer both run there — so this is about data shapes, not the runtime.

⚠️ **The Forget-account branch of the visibility assertion has never run.** The subflow picks a
branch by custody and every green arc ends Unauthenticated, so only the factory-reset branch is
exercised. **Flow 4 going red is what keeps it that way** — both runs on 2026-09-08 failed at
`assertVisible not "Protect my data"` after `account-submit`, which is unrelated to export (it is
the encryption-conversion flow) and wants its own look. Both branches render the same component
with the same testID, so the untested risk is layout, not logic.

## Open

**One, and it is a product question rather than a format one.** *Should importing a file we wrote
be all-or-nothing?* A `.vcf` from us is detectable before anything is parsed — `PRODID` names us,
which is why the writer emits it — so the review could offer "restore all of this" instead of a
per-card tick list. The argument for it is that a partial import of your own backup produces shapes
nobody asked for: 5c's degraded-edge milestone (a wedding landing on one partner because the other
was unticked) exists **only** because that is currently possible. The argument against is that the
same screen is the one honest place to see what a file contains before it lands.

It is a change to `ImportReview.tsx`, not to the parser, and it does not block 6.

Every *design* question is closed — the last of them, year-less dates, by measuring a real iPhone
rather than by argument, and that evidence now lives with the fixtures. What is left is building 6
and the three verifications above.
