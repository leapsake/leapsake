# Gifts — what the scope cut removed _(owner, 2026-08-20)_

Gifts were **cut back to four sentences** the day after the occasion work landed: log an idea,
attach it to one or more people or pets, mark a pairing given, keep a name and a URL. Everything
below was built, worked, and was deleted — see `361fc1d` for the cut, and `41ee888` / `476660b`
for the model as it stood. Nothing here is a bug or an omission; each is a decision to re-make
later, on purpose, with the code one `git show` away.


⚠️ **Restoring these costs a real migration.** They were removed under the pre-v0.1 latitude;
there are users now, so `gift_recipients` has to be widened rather than replaced.

- **Occasions** — the whole apparatus. A gift could name a milestone, a holiday, or (on an idea)
  a bare milestone _kind_, from a pool that was **ranked rather than filtered** across three
  tiers, and picking something the party did not have yet **created it** — the holiday
  observance, or a dateless milestone. That last part is the piece worth remembering: "Anna gets
  a Christmas gift" and "Anna keeps Christmas" were treated as the same fact, so the user never
  had to say it twice. `materializeOccasion` in `packages/core` was where it happened.
- **Dates, in both tenses** — a suggestion's `target_*` (intent: "for Christmas 2026") and a
  giving's plain `year`/`month`/`day` (what happened), on the milestone partial-date shape. With
  them went the "When?" shortcut row (`gift-when.ts`), which offered a couple of plausible years
  per tense rather than three number inputs.
- **Repeat givings.** The scotch you give your dad every Christmas was one suggestion and N
  dated gifts. It is now one ticked box; that it happened more than once is unrepresentable.
  **This is the case the three-table split existed for**, so re-adding dates and re-splitting are
  the same task.
- **The giver.** `gifts.giver_*`, nullable, meaning "unknown who gave it" — _not_ "me", since "I
  gave it" pointed at the `self_person` singleton. It is the schema half of received /
  third-party gifts, which the UI had already deferred. Dropping the column turned that from a
  future _screen_ into a future _migration_.
- **Idea-level occasions** (`gift_idea_occasions`, migration 34) — "this would make a good
  Christmas gift for someone", said with nobody named. Its own table because a candle is a
  birthday gift _and_ a housewarming gift, and a row per occasion merges where a column drops one
  under LWW. It was also the only place `occasion_type = 'kind'` was ever stored.
- **The "when is Anna's birthday?" nudge** — never built, and now has nothing to hang off. A
  dateless milestone created by picking an occasion was a question the app knew to ask; it would
  have been a fifth `SYSTEM_REMINDER_NAMESPACE` (`undated:`) alongside `milestone:` / `holiday:` /
  `onboarding:` / `duplicates:`.

Two supporting pieces went with them and would come back the same way: `HolidayEntry.giftGiving`
(a display-only catalog flag, outside the byte-pinning test, needing no `CATALOG_VERSION` bump)
and `isGiftBearingKind` (derived from a kind's own schedule offering a `gift` action, rather than
a second list that could disagree). The `moved` milestone kind and graduation's `gift` schedule
action were added alongside them but are **kept** — they are true about reminder schedules on
their own terms.

Also unbuilt, and unaffected by the cut: **suggestion → reminder** (a target date was never a
nag; the `due_date` + `@mention` escape hatch has no affordance on either client), **URL-first
title derivation** (waiting on the share target / browser extension that motivates it), and
**near-duplicate idea merging** via the reconciliation substrate.
