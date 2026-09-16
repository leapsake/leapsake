# Simplification workstreams (the 2026-09-16 investigation)

A survey of the repo for code that can be removed or simplified **with no end-user regression**.
The owner reviewed the findings and made the calls recorded below. Each doc here is one unit of
work for a future agent: it names the boundary, the order, the verification, and the decisions
already taken so the agent does not re-litigate them.

These docs follow the `plans/` rule: **each is deleted the day its work lands**, and anything
durable moves next to the code (a package `README.md`) or into `git log`. Nothing here is a
design record.

## The verdict

The architecture is sound. The dependency direction `schema → data → core → clients` has no
cycles; the micro-packages (`bytes`, `flags`, `highlight`, `store-layout`) cost five files each;
`createEntityRepo` keeps a whole repository like `people-repo.ts` at 72 lines; `API_CHANNELS`
keeps the desktop IPC honest by type; `view-models` is exactly the right dedup pattern. **Leave
those alone.**

The maintainability cost is concentrated in four places, and three of them are duplication or
accretion rather than missing abstractions.

| Non-test source              |                      Lines |
| ---------------------------- | -------------------------: |
| `apps/mobile`                |                     22,440 |
| `apps/desktop`               |                     10,850 |
| `packages/data`              |                      7,060 |
| `packages/schema`            |                      6,728 |
| `packages/ui`                |                      6,423 |
| `packages/core`              |                      4,789 |
| `scripts/`                   |                      8,492 |
| **Comment lines, repo-wide** | **23,079 of 73,155 (31%)** |

## The four workstreams, in execution order

| #   | Doc                                                | What it removes or simplifies                                                                                                                                 | Owner's call                                                                                                                         |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | [`relay-removal.md`](./relay-removal.md)           | The relay half of account/sync, written once per client and unreachable behind `multiDevice`. ~4,300 client lines plus the flag package and relay-only tests. | **Delete it.** Tag the last commit that has it so the v0.2 rebuild has a reference. Reverses the 2026-08-21 "keep it dark" decision. |
| 2   | [`core-decomposition.md`](./core-decomposition.md) | `packages/core/src/index.ts` (2,894 lines) implements import, reminders, gifts, holidays and entity cascades instead of composing them.                       | **Do it.** Mechanical, covered by typecheck plus the integration suite.                                                              |
| 3   | [`comment-pass.md`](./comment-pass.md)             | Decision history living in source comments. The reminders engine is 739 lines of code under 1,091 lines of comment.                                           | **Do it, and adopt the rule.** Behaviour comments only, under two lines, decisions go to `git log` and package READMEs.              |
| 4   | [`shared-form-logic.md`](./shared-form-logic.md)   | Form and field components that exist twice, once in `packages/ui/src/web` and once in `apps/mobile/components`, each owning its own state.                    | **Do it.** Move state and validation into `@leapsake/ui/headless` hooks; keep rendering per platform.                                |

Order matters: 1 removes code that 2 and 3 would otherwise have to refactor and re-comment;
2 shrinks the file 3 would spend the most time in; 4 is independent and can run in parallel
with 3.

## Rules that apply to every workstream

- **No end-user regression.** Anything a v0.1 user can reach today must behave identically.
  Workstream 1 removes only what `multiDevice: false` already hides.
- **One committable step at a time.** Each doc lists its steps; each step is a commit that
  leaves `pnpm test` green. Massive commits are how these refactors go wrong.
- **Verification, every step.** In a sandboxed agent shell:
  ```sh
  pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle
  pnpm exec vitest run     # after restoring the Node SQLite ABI; AGENTS.md → *The native SQLite ABI*
  ```
  On a developer machine, plain `pnpm test`.
- **The comment rule from workstream 3 applies to all code touched by 1, 2 and 4** from the
  moment 3's rule lands in `AGENTS.md`. Do not move a decision-history comment; delete it.
- **Do not add to `plans/`.** When a workstream finishes, delete its doc and this README's row.
  When the last row goes, delete the directory.
