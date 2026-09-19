# Simplification workstreams

Work that removes or simplifies code **with no end-user regression**. Each doc here is one unit
of work for a future agent: it names the boundary, the order, the verification, and the decisions
already taken so the agent does not re-litigate them. Each is **deleted the day its work lands**,
and anything durable moves next to the code (a package `README.md`) or into `git log`. Nothing
here is a design record.

**What is deliberately left alone:** the dependency direction `schema → data → core → clients`,
the micro-packages (`bytes`, `highlight`, `store-layout`), `createEntityRepo`, `API_CHANNELS`,
`view-models`, and core's role as the apps' single entry point (its re-exports carry that
decision on purpose, and `views.ts` stays in core because every builder reads through repo
ports).

## The workstreams, in execution order

| #   | Doc                                              | What it removes or simplifies                                                                                                                                      | Owner's call                                                                                                            |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | [`comment-pass.md`](./comment-pass.md)           | Decision history living in source comments. What remains: `apps/mobile` (about 5,600 comment lines), then the other packages, apps and `scripts/`. | **Do it, and adopt the rule.** Behaviour comments only, under two lines; decisions go to `git log` and package READMEs. |
| 2   | [`shared-form-logic.md`](./shared-form-logic.md) | Form and field components that exist twice, once in `packages/ui/src/web` and once in `apps/mobile/components`, each owning its own state.                         | **Do it.** Move state and validation into `@leapsake/ui/headless` hooks; keep rendering per platform.                   |
| 3   | [`ci-and-test-tiers.md`](./ci-and-test-tiers.md) | E2E flows standing in for a missing mobile hook tier; an E2E arc that never relaunches the app.                                                                    | **Do it.** Extract the unlock loop, add a hook tier, shrink the arc to one smoke plus the custody flows.                 |
| 4   | [`remote-releases.md`](./remote-releases.md)     | Releases run from a local machine. A tag pushed to the remote becomes the trigger; the pipeline builds every platform before uploading any; alpha/beta/rc become channels. | **Do it.** Nine decisions recorded in the doc; steps 1–4 are script-only and can start now.                             |
| 5   | [`dependency-balance.md`](./dependency-balance.md) | Bespoke code that a platform API or an already-present package covers (the relay's uncapped body reader, a hand-rolled base64, an ESLint plugin for one rule); the kept bespoke tooling gets a tripwire each. | **Do it.** Step 1 is a live vulnerability and goes first; the rest are independent. Kept items are not reopened until their tripwire fires. |

2 and 3 can run in parallel with 1. 4's steps 6–8 wait on the repo going public
([`../shipping.md`](../shipping.md) → Part 1, step 2). 5 is independent of all of them.

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
- **The comment rule applies to all code these workstreams touch** (`AGENTS.md` → _Principles_).
  Do not move a decision-history comment; delete it.
- **Do not add to `plans/`.** When a workstream finishes, delete its doc and this README's row.
  When the last row goes, delete the directory and the row in `plans/README.md` that points here.
