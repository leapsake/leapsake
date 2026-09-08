# `@leapsake/vcard`

**The vCard format, both directions**, kept as its own narrowly-scoped, independently-testable
unit outside `@leapsake/core`. It owns three concerns: **detecting** what a file is, **parsing**
it into a Leapsake-shaped `ParsedContact`, **writing** one back out — and one format-agnostic
concern, **ingesting** parsed contacts through injected ports.

## Named for the format, not the direction

It was `@leapsake/contact-import`. The rename is load-bearing: writing a card is the same grammar
inverted — `foldLine` against `unfold`, `escapeValue` against `unescapeValue`, `joinStructured`
against `splitStructured`, the same label and platform maps read backwards — and **the one test
that matters most, `parseVCards(writeVCards(x)) ≡ x`, only exists if both halves live together.**
Split across two packages it would be an integration test nobody owns.

`ParsedContact` is deliberately the *same type* in both directions for the same reason. A separate
`ExportContact` shape would let the reader's vocabulary and the writer's drift, and the round-trip
assertion would stop typechecking — which is exactly when it would stop being maintained.

## Parse liberally, write strictly

The reader tolerates the real-world spread of exports — v2.1/3.0/4.0, folded lines, grouped
properties, quoted parameters, bare 2.1 types, `X-APPLE-OMIT-YEAR`, partial `BDAY`s — because a
card arrives from whoever made it. The writer emits one dialect: vCard 4.0, CRLF, folded at 75
octets, `PRODID` naming us so an importer can detect the dialect before trusting any
`X-LEAPSAKE-*`.

Anything Leapsake has no column for (NOTE, ORG, PHOTO, a free-text address country) is routed to
`dropped` rather than discarded, so the import review can show the user exactly what will not
land.

## Two rules that point in opposite directions, and only evidence separates them

Both were settled by importing 16 probe cards into iOS Contacts on a real iPhone (2026-09-07); the
fixtures are in [`test/fixtures/`](./test/fixtures/). Re-run them against a device before trusting
either again.

**How to spell a date: the standard wins outright.** A year-less date is written `--0412`, never
Apple's `X-APPLE-OMIT-YEAR=1604:1604-04-12`. Both round-trip through *us*, so our own fidelity
does not decide it — what decides it is that the two failure modes are not symmetric. A consumer
that does not understand `--0412` loses the birthday, visibly. One that does not understand the
parameter reads **a person born in 1604**: data invented silently and synced onward attached to a
real person. `parseDateValue` already documented that judgment from the reading side; the writer
has a test asserting no placeholder year ever appears, because that is precisely what a
well-meaning "improve Apple compatibility" change reintroduces later.

**Which property carries an anniversary: Apple's extension wins outright.** RFC 6350's
`ANNIVERSARY` is **dead on arrival** — both probes failed, including one carrying an ordinary full
date, so iOS does not read the property at all. Every dated milestone goes out as
`itemN.X-ABDATE` + `itemN.X-ABLABEL` instead, which the same probes proved iOS files under a real
*Anniversary* field with the label intact. `ANNIVERSARY` stays read-only vocabulary: accepted from
other people's files, never emitted.

There is no "prefer the standard" rule that survives both. Re-open the second when a non-Apple
client ships, and **test rather than reason about it**.

## Apple's labels live in one file on purpose

A card exported from Contacts and the same card read through `expo-contacts` carry the *same*
labels — the vCard is a serialisation of the very record the device API hands back — so a rule
that lives in only one of the two importers is a bug waiting for whichever path the user happens
to take. `apple-labels.ts` is that one file: the `_$!<Work>!$_` constant unwrapping, and the
`DATE_KINDS` map from a date's label to a milestone kind.

`DATE_KINDS` is deliberately tiny. A label with no kind is surfaced as dropped — "Date
(Graduation)" — rather than guessed into `other`, so a stray date never mints a milestone. Adding
entries **pays twice**, since the iOS Contacts path gains the same kinds in the same change.

## The write side is not finished

`writeVCards` builds `plans/export.md` increment 1: the published person, their contact methods
and their birthday. Pets (`KIND:x-pet`), unpublished people as `RELATED`, the other nine milestone
kinds, relationships and Apple `itemN.X-ABLABEL` custom labels are increment 2.

**The reader lags the writer, and that asymmetry is temporary but real.** `UID` and `CATEGORIES`
are written but sit in `STRUCTURAL`/`dropped` on the way in, and the `X-LEAPSAKE-*` parameters
(`EXT`, `COUNTRY`, `USERID`) are written but not read — so **re-importing our own file duplicates
everyone, demotes every real relationship to an unpublished stub, and loses those fields.** That
is increment 5. Until it lands the gap is survivable only because the mobile import path reads
device Contacts and cannot open a `.vcf` at all; desktop's drag-drop *can*.

`write.test.ts`'s `asParsedToday` helper is where the gap is written down. When increment 5 lands,
delete it and compare directly — the test failing at that point is the signal it is no longer
needed.
