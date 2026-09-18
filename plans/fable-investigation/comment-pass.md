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

## Why this is worth a pass

| File                                   |      Total |    Comment |  Code |   Share |
| -------------------------------------- | ---------: | ---------: | ----: | ------: |
| `packages/reminders/src/engine.ts`     |      1,899 |      1,091 |   739 |     57% |
| `packages/key-custody/src/session.ts`  |      1,091 |        475 |   549 |     43% |
| `packages/data/src/migrations.ts`      |      1,174 |        496 |   665 |     42% |
| `apps/mobile/lib/core-context.tsx`     |      2,166 |        769 | 1,343 |     35% |
| `apps/desktop/src/main/index.ts`       |      1,437 |        514 |   855 |     35% |
| `packages/core/src/index.ts`           |      2,894 |      1,004 | 1,802 |     34% |
| **Repo, non-test source**              | **73,155** | **23,079** |       | **31%** |

Decision-history markers in non-test source, by grep:

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

Work file by file, biggest share first (the table above is the order). For every comment:

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
  an ISO date, `§`, a `plans/` path, `(owner`, `slice N`. It catches the short decision comments a
  length limit never sees. `used to`, `no longer` and `migration N` stay a reviewer's call, because
  they are just as often behaviour.

**The rare long comment is an exception you can see:**
`// oxlint-disable-next-line leapsake/max-comment-lines -- <why>`. Anyone can grep for those, and
a reviewer can question each one.

**The ratchet is scope, not N.** The rules are on only for directories the pass has finished,
through an `overrides` entry in `.oxlintrc.json` whose `files` list grows by one directory per
step. Test files are out of scope. When the last step lands, the rules move to the top level and the
override goes away.

The check stops long essays from coming back and catches the obvious history markers. It does not
do the pass: most of the cut is judgment on comments that are short and phrase-free.

## Steps, each a commit series

Each step ends by adding its directories to the rules' scope. `packages/schema` is done and in
scope; the `files` list in `.oxlintrc.json` is the record of what is.

1. `packages/reminders/src/engine.ts` (after workstream 2 has added `api.ts` there, or before;
   either order works, but do not do both in one commit).
2. `packages/key-custody`, `packages/data/src/migrations.ts`, the rest of `data`.
3. `packages/core` (after workstream 2, so the pass is over the small file).
4. `apps/desktop/src/main/index.ts`, `Settings.tsx`, `router.tsx`.
5. `apps/mobile/lib/core-context.tsx`, `settings.tsx`, then `components/`.
6. Everything else, by directory. `scripts/` last.

**How the schema step was verified, and how to repeat it:** each file was checked to print
identically to `HEAD` once comments are stripped (TypeScript's printer with `removeComments`), so
the pass provably changed no code. Durable "why" that no README held went into the owning
package's README (`reminders`, `holidays`, `sync`) or, when forward-looking, `plans/v0-2.md`.
