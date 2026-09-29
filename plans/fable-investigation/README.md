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

| #   | Doc                                                | What it removes or simplifies                                                                                                                                                                                                                              | Owner's call                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`comment-pass.md`](./comment-pass.md)             | Decision history living in source comments. What remains: `apps/mobile` (about 5,600 comment lines), then the other packages, apps and `scripts/`.                                                                                                         | **Do it, and adopt the rule.** Behaviour comments only, under two lines; decisions go to `git log` and package READMEs.                                                                                                                                   |
| 3   | [`ci-and-test-tiers.md`](./ci-and-test-tiers.md)   | E2E flows proving what a lower tier should: door negatives, form state, query behaviour, navigation config. Steps 1–3, 4a, 4b, 5, 6 and 6a landed (the arc is three flows; Forget account is proven in Vitest); 7 landed, retiring all four one-off flows. | **Do it.** Admission rule in `testing/crucial-flows.md`; step 4 decided 2026-09-24 (release build, iOS then Android); 4a, 4b, 5, 6, 6a, 7a, 7b and 7d landed 2026-09-24; 7c 2026-09-28.                                                                   |
| 4   | [`remote-releases.md`](./remote-releases.md)       | Releases run from a local machine. A tag pushed to the remote becomes the trigger; the pipeline builds every platform before uploading any; alpha/beta/rc become channels.                                                                                 | **Built.** Workflows and scripts landed 2026-09-27; left: the owner's go/no-go on hosted runners, the secrets, and a first real run.                                                                                                                      |
| 5   | [`dependency-balance.md`](./dependency-balance.md) | Bespoke code that a platform API or an already-present package covers (a hand-rolled base64, an ESLint plugin for one rule); the kept bespoke tooling gets a tripwire each.                                                                                | **Do it.** Steps 1 (the relay body cap), 2 (`@scure/base` in `bytes`), 3 (comment width in the local lint plugin) and 4 (Astro's zod on the website) landed 2026-09-28; the rest are independent. Kept items are not reopened until their tripwire fires. |

3 can run in parallel with 1. 5 is independent of all of them. The repo is public, so
4 has no gate left outside itself.

### Where 3 and 4 pull on each other

They are separate docs on purpose (different decisions, different lifetimes: 4 is deleted when
its step 8 lands, 3 outlives it). But four couplings are real, and doing them out of order costs
work:

- **3's steps 1–3 landed 2026-09-24**, which is what makes 4's step 7 gate cheaper: the
  unlock loop and gate state are tested below it, and **3's step 6 (landed) shrank the arc** to
  01 → smoke → 04, with both doors as 04's closing acts, so `ci.yml` never pays for a longer one.
- **3's step 4 (decided: E2E drives a release build) should land before 4's step 7 wires the gate into `ci.yml`.** Step 7 runs the
  device tiers on every push to `main`; whatever the gate costs and however often it flakes,
  that is what the repo pays from then on. The release-configuration build deletes the dev
  client, a third of the harness, and four stopper classes step 6 measured.
- **But 4's step 6 should close first**, because 3.4 invalidates its numbers: they measure a dev
  client, and step 6 asks only whether hosted runners can carry the gate at all.
- **4's step 6 has already paid its debt to 3.4** — the evidence is written into that step. Do
  not re-derive it.

**Ahead of both:** the native crash in 4's step 6 open item 3 (Android Flow 7c, now Flow 4's password act). It is
diagnosed as a react-native-screens race and patched (`patches/README.md`); 35990530595 ran
three Android jobs clean, and one more clean run confirms it.

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
