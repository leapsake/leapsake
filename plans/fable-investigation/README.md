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
accretion rather than missing abstractions. The line counts below predate the relay removal.

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

## The workstreams, in execution order

| #   | Doc                                                            | What it removes or simplifies                                                                                                                                 | Owner's call                                                                                                                          |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | [`comment-pass.md`](./comment-pass.md)                         | Decision history living in source comments. The reminders engine is 739 lines of code under 1,091 lines of comment.                                           | **Do it, and adopt the rule.** Behaviour comments only, under two lines, decisions go to `git log` and package READMEs.               |
| 4   | [`shared-form-logic.md`](./shared-form-logic.md)               | Form and field components that exist twice, once in `packages/ui/src/web` and once in `apps/mobile/components`, each owning its own state.                    | **Do it.** Move state and validation into `@leapsake/ui/headless` hooks; keep rendering per platform.                                 |
| 5   | [`ci-and-test-tiers.md`](./ci-and-test-tiers.md)               | E2E flows standing in for a missing mobile hook tier; an E2E arc that never relaunches the app. _The Vitest KDF cost landed 2026-09-16._                      | **Do it.** Extract the unlock loop, add a hook tier, shrink the arc to one smoke plus the custody flows.                              |
| 6   | [`remote-releases.md`](./remote-releases.md)                   | Releases run from a laptop. A tag pushed to the remote becomes the trigger; the pipeline builds every platform before uploading any; alpha/beta/rc become channels. | **Do it** _(owner, 2026-09-18)_. Nine decisions recorded in the doc; steps 1–4 are script-only and can start now. Absorbs the old `release-targets-per-rung.md`. |

**1 and 2 landed on 2026-09-17.** 1 was the relay removal (tag `relay-clients-final`; the
rebuild note moved to `plans/v0-2.md`). 2 took `packages/core/src/index.ts` from 2,885 lines to
1,154 and `sync.ts` from 737 to 83, which unblocks 3 — the file it would have spent the most
time in is now mostly gone. 4 and 5 can run in parallel with 3.

Two of 2's ten steps were not done. The re-export audit was **skipped** (owner): several of
those re-exports carry comments saying core is deliberately the apps' single entry point, and
the audit would have reversed that on ~56 client files. `views.ts` was **confirmed to stay** —
every builder reads through repo ports, so none of it is the pure derivation
`@leapsake/view-models` holds.

6 replaced `release-targets-per-rung.md` on 2026-09-18. That doc's gate filter is now step 3 of
the new one, and its "do not re-introduce a per-rung status" is reversed there, with the reason.

## Rules that apply to every workstream

- **No end-user regression.** Anything a v0.1 user can reach today must behave identically.
- **One committable step at a time.** Each doc lists its steps; each step is a commit that
  leaves `pnpm test` green. Massive commits are how these refactors go wrong.
- **Verification, every step.** In a sandboxed agent shell:
  ```sh
  pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle
  pnpm exec vitest run     # after restoring the Node SQLite ABI; AGENTS.md → *The native SQLite ABI*
  ```
  On a developer machine, plain `pnpm test`.
- **The comment rule applies to all code these workstreams touch** — it is in `AGENTS.md` as of
  2026-09-17. Do not move a decision-history comment; delete it.
- **Do not add to `plans/`.** When a workstream finishes, delete its doc and this README's row.
  When the last row goes, delete the directory, the row in `plans/README.md` that points here,
  and the `fable-investigation-plans` memory if one exists.
