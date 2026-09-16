# Comments explain behaviour, not decisions

**Decision (owner, 2026-09-16):** adopt the rule below going forward, then apply it to the
existing code in one pass. Decisions live in `git log` and in docs (package `README.md`s, not
`plans/`). Source comments exist only where the code is currently hard to understand.

## The rule

Add this to `AGENTS.md` → _Principles_, replacing the comment clause of the "Tests over docs"
bullet.

> **Comments explain behaviour, never decisions.** Default to a clear function name. If that
> is not enough, a comment of at most two lines saying what the code does that the name
> cannot. A longer comment is a discussion to have before writing it, not a default. Why a
> thing was decided, what it replaced, when, and by whom belongs in the commit message and, if
> it is durable, in the package `README.md`. Never in source, and never in `plans/`.

Explaining behaviour and explaining decisions are different acts. "Sort each person by
whichever name part they have" is behaviour and earns its two lines. "Retired on 2026-07-27
(migration 27) because layer 3's only consumer went away" is a decision and belongs to the
commit that made it.

## Why this is worth a pass

| File                                   |      Total |    Comment |  Code |   Share |
| -------------------------------------- | ---------: | ---------: | ----: | ------: |
| `packages/schema/src/reminder-rule.ts` |        944 |        549 |   350 |     58% |
| `packages/reminders/src/engine.ts`     |      1,899 |      1,091 |   739 |     57% |
| `packages/schema/src/milestone.ts`     |        973 |        458 |   475 |     47% |
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

## Steps, each a commit

1. Add the rule to `AGENTS.md`. Delete the sentence "Prefer well-named code over comments, but
   comments over unclear behaviour", which the new rule supersedes.
2. `packages/schema`: `reminder-rule.ts`, `milestone.ts`, `relationship.ts`, `composer-draft.ts`.
3. `packages/reminders/src/engine.ts` (after workstream 2 has added `api.ts` there, or before;
   either order works, but do not do both in one commit).
4. `packages/key-custody`, `packages/data/src/migrations.ts`, the rest of `data`.
5. `packages/core` (after workstream 2, so the pass is over the small file).
6. `apps/desktop/src/main/index.ts`, `Settings.tsx`, `router.tsx`.
7. `apps/mobile/lib/core-context.tsx`, `settings.tsx`, then `components/`.
8. Everything else, by directory. `scripts/` last.

## Keeping it true: a check, not a paragraph

`AGENTS.md` says anything a program can check is a check. Add
`scripts/comment-budget.test.mjs` beside `typography.test.mjs`: it fails when a non-test
source file has a comment block longer than N consecutive lines, with N starting at the
current worst and ratcheting down in later commits, the way the E2E gate ratchets. Exempt
license headers and the one-line JSDoc summary. Without the check, this pass will be needed
again in six months.
