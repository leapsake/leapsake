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

There is no "prefer the standard" rule that survives both.

**Both are measurements, so both expire.** Re-run `test/fixtures/` against a device — never
re-argue the reasoning — when either ground moves: **any iOS release that touches contact import** (does
Contacts still read `--0412`?), and **the day a non-Apple client ships** (a consumer that reads
`ANNIVERSARY` but not `X-ABDATE` loses anniversaries today, and writing both would double them up
on anything that reads both, so it stays one or the other).

## Apple's labels live in one file on purpose

A card exported from Contacts and the same card read through `expo-contacts` carry the *same*
labels — the vCard is a serialisation of the very record the device API hands back — so a rule
that lives in only one of the two importers is a bug waiting for whichever path the user happens
to take. `apple-labels.ts` is that one file: the `_$!<Work>!$_` constant unwrapping, and the
`DATE_KINDS` map from a date's label to a milestone kind.

`DATE_KINDS` is deliberately tiny. A label with no kind is surfaced as dropped — "Date
(Graduation)" — rather than guessed into `other`, so a stray date never mints a milestone. Adding
entries **pays twice**, since the iOS Contacts path gains the same kinds in the same change.

**A grouped `X-ABLABEL` names a contact method as readily as it names a date**, and it was once
read for dates and nothing else. Apple puts standard labels in `TYPE` and a user's own words
*only* in `item1.X-ABLABEL`, so every custom label on a card
straight out of an iPhone — "Beach house", "Mum's place" — arrived as "Other", the label the user
is least likely to have meant. `labelFrom` now takes the group label and lets it win outright,
which is also what Contacts itself displays; that fix is what lets the writer emit the same form.

## Writing the graph: three rules worth knowing

**Facts vCard has no vocabulary for ride *parameters*, not properties.** `X-LEAPSAKE-ROLE` and
`-REL-ID` on a `RELATED`, `-MILESTONE-ID`/`-KIND`/`-NOTE`/`-REL` on an `X-ABDATE`,
`-EXT`/`-COUNTRY` on a `TEL`. Partly so a fact cannot be separated from what it qualifies — but
mostly because an unknown *parameter* is invisible to any parser, while an unknown *property*
lands in this reader's own `dropped` list. Spelled as properties, a user re-importing their own
file would be shown a list of their own fields that "could not be imported".
`X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED` are the only two facts with nothing to ride, so they
are properties — which is why the parser had to be told to ignore them by name until it could read
them (a `DEFERRED` set, now gone; see below).

**A role is written as its base, with the exact role beside it.** Leapsake has 41 relationship
roles and RFC 6350 gives seven words, so `mother` goes out as `TYPE=parent` — what a standards
consumer can act on — plus `X-LEAPSAKE-ROLE=mother`. `TYPE=mother` would tell a third party
nothing *and* lose the kinship through our own `RELATED_ROLES`, which has no entry for it. The one
exception is role `other`, whose `TYPE` is the user's note **bare**: `relatedFrom` turns an
unmapped type into exactly the word it read, so `muse` round-trips and `x-muse` would not.

**A relationship's milestone is written on both partners' cards, with one id.** A wedding is borne
by the marriage rather than by either partner. `X-LEAPSAKE-MILESTONE-REL` says which edge, and the
shared `-ID` is what tells an importer this is one fact written twice rather than two facts.

The edge itself works the same way, and `ingestContacts` leans on it: a `RELATED` appears on both
partners' cards, so the shared `X-LEAPSAKE-REL-ID` is what stops one relationship being imported as
two. That is why the engine resolves references in a second phase — the first cannot know whether
the other end exists yet, and writing from each card would double every edge.

## The reader still lags the writer, by less

`writeVCards` builds the whole person graph: people and pets, contact methods, all ten milestone
kinds, and the relationships between them. The reader is catching up in numbered increments.

**The card's own identity now survives the round trip.** `UID`, `KIND`, `REV`, `CATEGORIES`,
`X-LEAPSAKE-SELF` and `-CREATED` are read, as are the `-EXT`/`-COUNTRY`/`-USERID` parameters — so
a pet re-imports as a pet, tags come back, and a card whose `UID` names somebody already stored is
reported as **already stored** rather than silently becoming a second copy of them. The parser's
`DEFERRED` set existed to hold the last two quiet until this landed, and is gone.

**The relationship graph survives too**, as of 5b. `X-LEAPSAKE-ROLE` brings the exact role home,
so `mother` no longer comes back as `parent` nor `cousin` as `other`; a `RELATED` pointing at
another card by `urn:uuid:` resolves against that card, taking its name from the `FN` a reference
cannot carry. **Resolution is a whole-file property**, which is why `parseVCards` indexes every
card's UID before building any of them — the edge and the card it names arrive in either order.
A reference to a card that is *not* in the file still lands in `dropped`, honestly.

**And the milestones survive, as of 5c.** `X-LEAPSAKE-MILESTONE-KIND` is what carries all ten
kinds through a format with vocabulary for one — so **our own file needs no label guessing at
all**, which is precisely what leaves `DATE_KINDS` about other people's cards alone. `-NOTE`
carries the free text a label cannot; `-REL` and the shared `-ID` put a wedding back on the
marriage, **once**, though the writer wrote it on both partners' cards. `ingestContacts` defers
those to its second phase for the same reason it defers edges: the marriage does not exist while
either card is being built.

**What is still guessed** is a *foreign* card's date label — increment 5d, and the only thing
`DATE_KINDS` was ever for. The spec is [`plans/export.md`](../../plans/export.md) → *5 — The
import-side reciprocals*.

**Two things the ids are not.** They are matching keys, not row ids: an imported card always gets
a fresh id, and `X-LEAPSAKE-CREATED` is parsed but not applied, because writing the file's ids and
timestamps back verbatim is a *restore* — increment 6, and a different promise.

`write.test.ts`'s `asParsedToday` helper was where the remaining gap was written down, and it
shrank as each increment landed. **It has now reached the end state it was always going to**, and
should not be emptied further: `writeParam` strips `"` and folds newlines to a space, because
vCard's parameter grammar has an escape for neither, so a multi-line milestone note is knowingly
not byte-exact. That one normalisation, plus a milestone carrying no date at all, is all that is
left in it.
