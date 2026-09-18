# Comments explain behaviour, not decisions

**Decision (owner, 2026-09-16):** adopt the rule below going forward, then apply it to the
existing code in one pass. Decisions live in `git log` and in docs (package `README.md`s, not
`plans/`). Source comments exist only where the code is currently hard to understand.

## The rule

**Landed in `AGENTS.md` → _Principles_.** It is in force for every file any workstream touches;
what is left here is the pass over the code that predates it.

Explaining behaviour and explaining decisions are different acts. "Sort each person by
whichever name part they have" is behaviour and earns its two lines. "Retired on 2026-07-27
(migration 27) because layer 3's only consumer went away" is a decision and belongs to the
commit that made it.

## Status

**Step 1 (`packages/schema`) is done and lint-enforced. Step 2 (`packages/reminders`) is next.**
The `files` list of the comment-rules override in `.oxlintrc.json` is the record of which
directories are finished.

## Why this is worth a pass

The biggest remaining files, measured 2026-09-18:

| File                                  | Total | Comment | Share |
| ------------------------------------- | ----: | ------: | ----: |
| `packages/reminders/src/engine.ts`    | 1,858 |   1,061 |   57% |
| `packages/key-custody/src/session.ts` | 1,090 |     474 |   43% |
| `packages/reminders/src/api.ts`       | 1,017 |     436 |   43% |
| `packages/data/src/migrations.ts`     | 1,174 |     496 |   42% |
| `apps/desktop/src/main/index.ts`      |   810 |     318 |   39% |
| `apps/mobile/lib/core-context.tsx`    | 1,401 |     490 |   35% |
| `packages/core/src/index.ts`          | 1,153 |     271 |   24% |

"Comment" counts lines starting with `//`, `*` or `/*`. For scale: `packages/schema` went from
about 2,850 comment lines to about 900.

Decision-history markers in non-test source, by grep, before the pass began:

| Pattern                                                    | Hits |
| ---------------------------------------------------------- | ---: |
| an ISO date                                                |  334 |
| `§` (a section reference into `plans/encryption/model.md`) |  295 |
| `used to`                                                  |   86 |
| `plans/`                                                   |   75 |
| `no longer`                                                |   56 |
| `slice N` (custody slice numbers)                          |   49 |
| `(owner, 20…)`                                             |   44 |
| `migration N`                                              |   28 |
| `retired`                                                  |   18 |

Each of those is a comment that will be wrong the moment the referenced doc, slice, or plan
moves, and the repo's own `plans/README.md` already says finished work leaves `plans/`.

## The procedure

Work step by step (_Steps_ below), and within a step file by file, biggest share first. For
every comment:

1. **Restates the code** (`// increment the counter`, a JSDoc that repeats the signature)
   → delete.
2. **Decision, history, or provenance** (a date, a slice or migration number, "was", "used
   to", "retired", "replaced", "(owner, …)", a `plans/` path, a `§` reference) → delete. If the
   _durable_ part (an invariant that still holds and is not obvious from the code) is not
   already in the package `README.md`, add one sentence there. Do not move the paragraph.
3. **Explains behaviour the code cannot** (a non-obvious ordering, a platform quirk, why a
   guard exists) → keep, cut to two lines. If it cannot be cut to two lines, first try to make
   the code say it (a named function, a named constant, a type); if it still cannot, leave it
   and flag it in the commit message for discussion.
4. **JSDoc on an exported symbol** → keep a one-line summary; `{@link}` cross-references are
   fine; move anything longer under rules 1 to 3.
5. **A comment that names a test** (`proved by X.test.ts`) → delete; the test is the proof and
   its name should carry it.

Package `README.md`s are in scope for the same reasons, but with a lighter hand: they are the
right home for durable "why", and `packages/reminders/README.md` (801 lines) and
`packages/key-custody/README.md` (519) are where much of the deleted source history should
already be. Check that it is, and do not duplicate it back.

**Do not touch behaviour.** This pass changes no code except renames and extractions made to
replace a comment. If a comment turns out to be the only thing that explains a real bug,
leave it and open the bug separately.

## The check: two oxlint rules, scoped by step

`AGENTS.md` says anything a program can check is a check. No existing ESLint or oxlint rule caps
how many lines a comment block runs (`max-lines` counts code; `multiline-comment-style` is about
style), so the check is a local oxlint JS plugin, `scripts/lint/comment-rules.mjs`, run by the
existing `pnpm lint`:

- **`leapsake/max-comment-lines`**, max 2 from day one. It counts consecutive own-line `//`
  comments as one block and a `/** */` block by its prose lines. It does not start loose and
  ratchet down: the limit is the rule.
- **`leapsake/no-decision-comments`** flags the markers above that are precise enough to lint:
  an ISO date, `§`, a `plans/` path, `(owner,`, `slice N`. It catches the short decision comments a
  length limit never sees. `used to`, `no longer` and `migration N` stay a reviewer's call, because
  they are just as often behaviour.

**The rare long comment is an exception you can see:**
`// oxlint-disable-next-line leapsake/max-comment-lines -- <why>`. Anyone can grep for those, and
a reviewer can question each one.

**The ratchet is scope, not N.** The rules are on only for directories the pass has finished,
through an `overrides` entry in `.oxlintrc.json` whose `files` list grows by one directory per
step. Test files are out of scope. When step 7 lands, the rules move to the top level and the
override goes away.

The check stops long essays from coming back and catches the obvious history markers. It does not
do the pass: most of the cut is judgment on comments that are short and phrase-free.

## Working a step

1. **Read the package's `README.md` first**, so you know which "why" already has a home there.
   Most deleted history needs nothing added, because the README or `git log` already has it.
2. **See what the rules flag** in a directory that is not yet in scope:
   ```sh
   pnpm exec oxlint -c scripts/lint/comment-rules.oxlintrc.json packages/reminders/src
   ```
   The findings are a floor, not the job: _The procedure_ item 2 also covers short comments no
   lint rule sees.
3. **Edit one file (or a few small ones), then, before committing, prove only comments changed:**
   ```sh
   node scripts/lint/comments-only.mjs          # every changed .ts/.tsx/.mjs against HEAD
   pnpm exec oxfmt <the .ts files you touched>
   ```
   `comments-only.mjs` prints each file with TypeScript's printer, comments stripped, and compares
   it to `HEAD`. Anything reported as `CODE CHANGED` is a mistake unless it is a deliberate rename
   or extraction, which the commit message must then name.
4. **Commit per file or small group, straight to `main`.** The message says where the deleted
   history lives (a README section, a commit hash) and ends "Code is unchanged." Durable "why"
   that no README holds goes into the owning package's `README.md` as a sentence or two;
   forward-looking notes go to the matching section of `plans/v0-2.md`.
5. **Finish the step:** add the directory to the comment-rules override's `files` list in
   `.oxlintrc.json`, run the verification in [`README.md`](./README.md) → _Rules that apply to
   every workstream_, update the _Status_ and the table here, and commit.

Conventions the schema step settled:

- **Wrap comments at 80 columns** in `packages/`, as the code there is. Nothing checks this, so a
  two-line limit is two lines of 80, not two lines of 100.
- **A section banner** (`// ---` / `// Title` / `// ---`) counts as three lines. Make it a single
  `// Title`.
- **Never run `oxfmt` on Markdown.** The repo excludes `*.md` from formatting, and running it
  on a README rewrites unrelated emphasis and tables.
- **README history markers stay.** `(owner, 2026-09-05)` in a package README is the right home
  for a decision; the lint rules apply to source only.
- **A trailing `//` comment on a code line** is not grouped with its neighbours, so a column of
  field comments is fine as long as each stays short.

## Steps, each a commit series

1. ✅ `packages/schema`. Done 2026-09-18, in scope.
2. **`packages/reminders/src`**: `engine.ts`, then `api.ts` and `index.ts`. Tests in
   `packages/reminders/test` are out of scope. `packages/reminders/README.md` (about 800 lines)
   already carries most of the reasoning these files repeat: identity, windows, the prompt,
   schedules, onboarding nudges, merge safety. Check it before adding anything. Scope entry to
   add when done: `"packages/reminders/src/**"`.
3. `packages/key-custody`, `packages/data/src/migrations.ts`, the rest of `data`.
4. `packages/core`.
5. `apps/desktop/src/main/index.ts`, `Settings.tsx`, `router.tsx`.
6. `apps/mobile/lib/core-context.tsx`, `settings.tsx`, then `components/`.
7. Everything else, by directory. `scripts/` last.
