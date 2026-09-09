# Export — what is left

> **Only the unbuilt half.** The exporter shipped in four increments over 2026-09-07/08 and a user
> can save their whole store as a `.zip`; **GA does not block on any code here.** What remains is
> the *import* side, desktop, and three verifications. The format, the decisions behind it and the
> evidence for them live next to the code that has to obey them — see below.
> **Delete this file when 5 and 6 land.**

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

## 5 — The import-side reciprocals

**Not GA-blocking, but it decides whether the file is readable back**, and today it is not.
`writeVCards` builds the whole person graph; the parser ignores most of it.

**Until this lands, re-importing our own export duplicates everyone, demotes every real
relationship to an unpublished stub, and loses those fields.** Survivable only because the mobile
import path reads device Contacts and cannot open a `.vcf` at all — **desktop's drag-drop can**
(`apps/desktop/src/renderer/src/App.tsx`), so this is a real trap for a desktop user pointed at
their own backup.

**The four files.** The reader is `packages/vcard/src/vcard.ts` (`STRUCTURAL`, `DEFERRED`,
`relatedFrom`, `parsedContactFrom`); the label maps are `src/apple-labels.ts`; the write side that
already emits all this is `src/write.ts`; and `ImportPorts` — what core must implement — is
`src/ingest.ts`. Core wires it at `packages/core/src/index.ts` → `import.preview` / `import.commit`.

What has to be read:

- `CATEGORIES` → tags. **Smaller than it looks**: `ParsedContact` already carries `tags` (and
  `uid`), because the writer needed somewhere to read them from. What is left is the parser
  filling it, `ImportPorts` gaining `addTags`, and core wiring that to the `tags.setEntityTags` it
  already calls when creating a person or pet.
- Every `X-LEAPSAKE-*` **parameter** the writer emits: `EXT`, `COUNTRY`, `USERID`, `ROLE`,
  `REL-ID`, and `MILESTONE-ID`/`-KIND`/`-NOTE`/`-REL`.
- **Seven** new `DATE_KINDS` entries — see the warning below before writing any.
- `KIND:x-pet`, `REV`, and `UID` out of the parser's `STRUCTURAL` set — `UID` is what unblocks the
  deferred `urn:uuid:` second pass for `RELATED`, which is the TODO on `relatedFrom`.
- The parser's `DEFERRED` set (`X-LEAPSAKE-SELF`, `-CREATED`).

Every one of those is a field the *reader* currently fills with its absent value, so the shape is
already there to be filled in.

### `DATE_KINDS` is the part most likely to be built wrong

**Do the `-MILESTONE-KIND` parameter first, and notice what it leaves.** `write.ts` already carries
each date's kind outright, and its header calls that parameter the load-bearing one for exactly
this reason. Read it and **our own file needs no label guessing at all** — `DATE_KINDS` then
matters only for *other people's* cards, which is a much smaller and much less urgent job than the
bullet list makes it look.

Four traps in that map, none of them guessable from the outside:

- **It is keyed by the lower-cased human label, not the kind slug.** `dateKindFor` does
  `DATE_KINDS[label.trim().toLowerCase()]`, and the label the writer emits is
  `kindDefs[kind].label` from `@leapsake/schema`. So the keys are `"first date"` and
  **`"started a job"`** — not `first-date` or `job-start`.
- **Seven entries, not nine**: `death`, `first-date`, `wedding`, `met`, `graduation`, `job-start`,
  `moved`.
- **`birthday` is excluded on purpose** and must stay excluded. `apple-labels.ts` says why in as
  many words: a birthday-labelled date fills the contact's birthday rather than minting a dated
  milestone, and only when the source's dedicated field had nothing — so a card that spells its
  birthday twice can never mint a second one. Adding it re-breaks that.
- **`other` can never be an entry.** Its label is the *user's note* ("Beach house closing"), so no
  map resolves it. Recovering `other` is what the `-MILESTONE-KIND` parameter is for; for a
  stranger's card it stays dropped, which is the deliberate rule stated above `DATE_KINDS`
  ("a label with no kind here is surfaced as dropped rather than guessed into `other`"). **Do not
  reverse that rule as a side effect** of this increment.

⚠️ **And it pays twice and costs twice.** That map is shared with the device importer, so an iOS
contact labelled "Graduation" starts minting milestones **in the same change**. That is a
user-visible behaviour change on a path nobody asked to change, and it wants its own tests.

**Two signals that this has landed**, both of which should be deleted rather than updated:
`DEFERRED` empties out, and `write.test.ts`'s `asParsedToday` helper goes away in favour of
comparing directly. `asParsedToday` is meanwhile the **ledger of every gap** — what vanishes
silently, what falls to `dropped`, and how a role degrades (`mother` → `parent`;
`cousin` → `other` + note) — each with a golden-text test beside it, so nothing in the gap is
merely asserted.

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

**Nothing.** No design question is outstanding — the last of them, year-less dates, was closed by
measuring a real iPhone rather than by argument, and that evidence now lives with the fixtures.
What is left here is only building 5, 6, and the three verifications above.
