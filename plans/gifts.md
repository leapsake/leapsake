# Leapsake Gifts — ideas, suggestions & givings (why & shape)

> **Design doc — the stable "why it's shaped this way".** Sequencing/status lives in
> [`status.md`](./status.md); how each increment was built lives in `git log`; the product
> model in [`product-truths.md`](./product-truths.md). This doc never restates status.

## The idea

Three distinct facts, deliberately three tables — the correction that shaped the whole
design is that these are different things, not one thing with a status column:

| Row | Reads as | It is |
|---|---|---|
| **GiftIdea** — `gift_ideas` | "A Red Ryder BB Gun" | a thing in the world — reusable, person-agnostic |
| **GiftSuggestion** — `gift_suggestions` | "Ralphie would like a Red Ryder BB Gun" | a candidate: idea × recipient |
| **Gift** — `gifts` | "Ralphie was given one, Christmas 1941" | a dated event: something changed hands |

Why not collapse them:

- **Idea ≠ suggestion.** "A BB gun" is a statement about the *thing*; "Ralphie would like
  one" is about a *person*. The idea has a URL; a person doesn't. An idea can be suggested
  for zero-to-many people.
- **Suggestion ≠ giving.** A suggestion is a set membership (a candidate); a giving is a
  dated event. Their cardinality differs: the scotch you give your dad every Christmas is
  **one** suggestion and **N** givings. A `status: considering | given` column on a join
  can only remember the most recent giving — losing exactly the history worth keeping.

**A giving points at the idea, never at the suggestion.** `gifts.gift_idea_id` +
recipient — not `suggestion_id`. This buys three things at once: you can log a gift you
never shortlisted; the suggestion list renders "✓ given, Christmas 1941" as a **query** on
`(gift_idea_id, recipient)` with no FK, no state column, nothing to keep in sync between
the two rows; and repeat gifts work with nothing re-created. When a gift is given, the
suggestion **does not change state** — it stays, and the default shortlist view filters
given ones out (the same non-destructive posture as `hidden_holidays`: no row mutates, a
query just reads differently).

## Slice 0 — the self-person (blocks everything below)

Gifts need to know who "you" are (who gave / received), and **there is no self concept
anywhere in the codebase today** — relationships are symmetric pairs with no ego anchor.
Gifts are the first feature to *need* it, not the reason it should exist: a self-person is
also the future ego anchor that lets kinship say "my sister" instead of describing every
relationship from nowhere, and the "me" of vCard export and share attribution.

### Storage: a singleton domain row, not `account`, not `people.is_self`

```sql
CREATE TABLE self_person (
  id         TEXT PRIMARY KEY,   -- one CONSTANT deterministicUuid, identical on every device
  person_id  TEXT NOT NULL,      -- non-polymorphic: you are a Person, never a Pet
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
```

It is an ordinary **synced** row (in the `syncableRepos` allowlist), plaintext.

- **Not `account.self_id`.** The `account` row is created *only at enable-sync*
  (`beginAccount`/`enableSync` mint it when the user sets a password; `kdf_salt` /
  `auth_verifier` are `NOT NULL`, so there is no "empty" account). A **local-only user has
  no account row** — a first-class, fully-supported mode — so `self_id` would have nowhere
  to live. And `account` is **deliberately absent from the sync allowlist** (zero-knowledge;
  see `core/sync.ts`): it re-establishes on a new device by re-deriving from the relay's
  *blind* material, not by row replication. `person_id` points into the synced **people**
  rows, so it must ride the **people** sync channel and land atomically with them — not the
  account-identity channel (which would leak a person UUID to the relay and arrive
  out-of-band from the row it references). Account *transfer on login* is identity recovery,
  not row sync.
- **Not `people.is_self` + partial-unique-index.** Two devices each marking a *different*
  person as self are both valid locally; on merge the second violates the unique index — a
  **hard sync failure**, unrecoverable without manual intervention. A **fixed-PK singleton**
  converges instead: both devices write the *same* primary key, so whole-row LWW resolves it
  like everything else (last writer wins, exactly one row, no error). Use `deterministicUuid`
  (`@leapsake/bytes`) for the constant, as mentions do for theirs.

### What slice 0 actually ships

- The table + repo + a `getSelf()` / `setSelf(personId)` core surface. That's the whole
  data increment — **it just exists.**
- **Your Person is a regular Person** — no special columns, appears in the people list, has
  milestones/contact-methods/relationships like anyone else. "Self" is a single pointer at
  it, nothing more.
- **Established during onboarding**, not gated at first launch and *not* reliant on gift
  interaction. Woven into the existing reminders-based onboarding CTA set.
- **Import is a natural prompt point.** When you import via contacts/vCard and haven't
  picked yourself yet, that's a good moment to prompt "pick you from the list, or tell us
  about yourself."
- **Reminder engine becomes self-aware — it does *not* exclude you.** Today it would emit
  "🎉 Wish @You a happy birthday" for your own birthday milestone. Instead it detects the
  self-person and renders a **self-directed** wish (e.g. "🎂 It's your birthday!") — one
  branch in the copy layer keyed on `getSelf()`, not a filter.

### Deferred (pre-v0.1, not in slice 0)

Using the self-person as the **launching-off point for building out close relationships,
family, and friends** — the kinship ego anchor. Real payoff, materially bigger work; it
follows once the pointer exists.

## The three gift tables

All **plain syncable rows, no per-item content keys.** This corrects an earlier instinct
to encrypt notes on the `milestone.note` precedent: `product-truths.md` delta 2 argues
*against* per-field content-key encryption on new entities (encryption trends toward a
user-level layer choice), and `reminders` already sets the precedent — plaintext, protected
by whole-DB-at-rest + master-key-sealed sync. `milestone.note` is the legacy exception, not
the direction.

### GiftIdea — `gift_ideas`

- `title` (required), `url` (optional), `notes` (optional).
- A gift **always** has an idea. Logging "I gave Ralphie a BB gun" mints the idea and the
  gift in **one transaction** if "BB gun" doesn't exist yet (core owns atomicity; the IPC
  handler stays a thin bridge). Consequence, chosen deliberately: the ideas list picks up
  everything ever given — a **UI** concern (default the top-level list to not-yet-given
  ideas, sort given ones down), not a schema one.
- **Near-duplicates are tolerated, not auto-merged** ("BB gun" vs "Red Ryder BB Gun"):
  titles are prose, and silent tag-style normalization would be worse than the dupes. The
  eventual answer is the existing reconciliation substrate (`duplicate-service.ts`,
  `not_a_duplicate`, the generalized `mergeEntities` already on the follow-on list) — gift
  ideas as its next consumer. Not v1.

### GiftSuggestion — `gift_suggestions`

- `gift_idea_id`, recipient `(recipient_type, recipient_id)`, optional **occasion**,
  optional **target partial date**. **No note, no state, no giver** in v1 (a suggestion is
  almost always from the user, and it's a bare-ish join by design; a note is easy to add
  later — start simple).
- **Giver omitted on purpose** — unlike a gift, a suggestion implicitly originates with the
  user.

### Gift — `gifts`

- `gift_idea_id` (**required**), giver `(giver_type, giver_id)` **nullable**, recipient
  `(recipient_type, recipient_id)` **required**, optional **partial date** (what happened),
  optional **occasion**.
- **`null` giver means "unknown who gave it"** — *not* "me". "I gave it" is represented by
  the giver pointing at the **self-person** (a real Person now). Being explicit avoids the
  sentinel-leaks-everywhere trap of null-as-me.

| Case | giver | recipient |
|---|---|---|
| I gave Ralphie a BB gun | self-person | Ralphie |
| Alice gave me a scarf | Alice | self-person |
| Ralphie's uncle gave him one | Uncle | Ralphie |
| Someone (unknown) gave Ralphie one | `null` | Ralphie |

- Refine: giver ≠ recipient when both set.
- **v1 UI writes only "I gave X to Y"** (giver = self, recipient = Y). Received and
  third-party gifts are then pure **UI increments** against an unchanged schema.
- **Gifts get their own Person-screen section, not the milestone timeline.** A giving is
  milestone-shaped (dated fact, partial date, free note) but has a second party and an FK a
  milestone has no room for, and no use for `recursAnnually` / reminder schedules. So: its
  own table and its own "Gifts given" section — reusing the partial-date shape, not the
  rendering.

## Partial dates & occasions (on both suggestion and gift)

Reuse the milestone **partial-date shape** (`year`/`month`/`day` individually nullable, the
tested **day ⇒ month** refine, precision *derived* via `datePrecisionOf`) — the retro-log
case ("Christmas 1941", "sometime in 2023") needs exactly this, and a flat epoch-ms would
force false precision.

- **Gift** uses plain `year`/`month`/`day` — *what happened*.
- **Suggestion** uses `target_year`/`target_month`/`target_day` — *intent*. Different column
  names so the semantics never blur.

**Occasion** is a nullable polymorphic pointer `(occasion_type, occasion_id)` →
`milestone | holiday`, its own enum `giftOccasionTypeSchema = z.enum(["milestone","holiday"])`
so a third occasion type is one line later. It sits on **both** rows.

The date is the source of truth for *when*; the occasion is a **label**, and it can't pin
the date on its own — the holidays work proved a holiday reference is ambiguous (a lunisolar
holiday can fall twice in one Gregorian year, which is why the engine keys occurrences on
date). So the occasion references the **holiday** (not an observance); the date + person
resolve the occurrence. Payoff: it runs in reverse for free — pick "Christmas" + 1941 and
`occurrencesFor` (`@leapsake/holidays`) fills in Dec 25 1941.

Meanings that fall out of one shape (per the discussion — an occasion alone does **not**
imply "every year until acted on"; it can simply mean "a Christmas, year unremembered"):

| occasion | target date | means |
|---|---|---|
| Christmas | — | for Christmas, year unspecified |
| Christmas | 2026 | that specific Christmas |
| — | 2026-03-03 | an arbitrary date (before her trip) |
| — | — | someday |

**A target date is not a nag.** If the user wants to be reminded, the suggestion spawns a
**Reminder** (existing machinery: `due_date` + an `@Ralphie` mention) — never a second,
competing due-date system inside gifts.

## Recipient / giver / occasion enums

Own enums, per the house convention that each concern owns its bearer enum (see
`tagging.ts`'s note on why):

- `giftPartyTypeSchema = z.enum(["person","pet"])` — recipient (both rows) and giver (gift).
  Reserves `relationship` as a plausible fourth party ("we gave the Smiths a wedding
  present") — one line, no migration, exactly as `milestoneBearerTypeSchema` did.
- `giftOccasionTypeSchema = z.enum(["milestone","holiday"])`.

## Single-payload create surfaces (share-target ready)

The future includes phone "share via Leapsake" and a browser extension — each **posts one
object**. So the create surface must be a single payload, not a wizard, or that path gets
re-plumbed later. Ingest at the edge like the vCard importer (parse at the edge → one core
call), never a multi-round-trip flow.

```ts
// Top-level: capture an idea and (optionally) suggest it for zero-to-many people at once.
createGiftIdea({
  title, url?, notes?,
  suggestFor?: [{ recipientType, recipientId, occasion?, targetDate? }]   // one transaction
});

// Log a giving; mints the idea in the same transaction if it's new.
createGift({
  recipient, giver?, date?, occasion?,
  giftIdea: <existing id> | { title, url? },
});
```

An idea shared from a web page may arrive **URL-first with no title** — derive one from the
page title or host.

## Packaging

**No new package.** `gift_ideas`/`gift_suggestions`/`gifts` have no pure logic comparable to
the holidays recurrence engine — schema in `packages/schema`, repos in `packages/data`,
wiring in `packages/core`. Revisit only if idea *suggestion* logic ever appears.

## Sequencing (proposed)

- **0. Self-person** (migration for `self_person`): table + repo + `getSelf`/`setSelf`,
  onboarding hook, import prompt, self-aware birthday wish, a "You" affordance in the people
  list. **Blocks 1–6.**
- **1. GiftIdea** + repo + core + desktop `/gifts` top-level list. Useful alone — a standalone
  idea/shopping list.
- **2. GiftSuggestion** + the `suggestFor` one-action create + a "Gift ideas" section on
  Person/Pet, authorable from either end (the Holidays precedent).
- **3. Gift** + a "Gifts given" section on Person + the given-annotation query on suggestions
  + surfacing "you gave them this in 1941" when adding a suggestion (the re-gift guard).
- **4. Tags on gift ideas** (`"gift_idea"` → `tagBearerTypeSchema`) + gift search (its own
  result type, the tag/holiday precedent).
- **5. Reminder loop**: the existing `🎁 gift` action deep-links to the recipient's
  suggestions; completing it offers "record what you gave" → a Gift. Closes the loop the
  `gift` action already opens with no payoff behind it.
- **6. Mobile port** (forms as faithful ports of the desktop forms).
