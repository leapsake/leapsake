# AGENTS.md

Guardrails and conventions. **This file is deliberately short.** It holds only what is both
(a) likely to be counterintuitive, and (b) applicable across most work in the repo.
Everything else lives next to the code it constrains — and anything a program can check is a
check, not a paragraph here.

| You want… | Go to |
|---|---|
| What to work on next | [`plans/status.md`](plans/status.md) — the single status oracle |
| The project map | [`plans/README.md`](plans/README.md) |
| Setup, testing philosophy, release rules | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| How the shared layer is arranged | [`packages/README.md`](packages/README.md) |
| Why a package is shaped the way it is | that package's own `README.md` |
| How an app runs, and its platform traps | that app's own `README.md` |

## Principles

- **Simpler is better.** Prefer less code, but prefer legible code over concise code.
- **Small, incremental, independently committable changes.** Massive commits create errors.
- **Offline-first, progressively enhanced.** No cloud dependency to use the app.
- **Generalized logic goes in `packages/`; client-specific logic in that client's `apps/`
  project.** New domain logic gets its own package, not a folder inside `core`.
- **Add a dependency only when it pays for itself, and say why** where it lands (the
  package's README, or the commit that adds it). The set is deliberately lean;
  `package.json` is the list, and there is no second copy of it to consult.
- **Tests over docs.** A well-written test cannot drift from behavior; a doc can.
- **Comments explain behavior, never decisions.** Default to a clear function name. If that is
  not enough, a comment of at most two lines saying what the code does that the name cannot. A
  longer comment is a discussion to have before writing it, not a default. Why a thing was
  decided, what it replaced, when, and by whom belongs in the commit message and, if it is
  durable, in the package `README.md`. Never in source, and never in `plans/`.
- **Test the thing as a black box.** Assert what the consumer sees, not the implementation.
- **Use the right quotation marks** in anything a person reads — “Father’s Day”, not
  "Father's Day". Enforced for the message catalog by `scripts/typography.test.mjs`.

## Product posture — why it must feel this way *(decided 2026-07-05)*

Stable, and shapes *how* every increment is built rather than what gets built next.

- **Laypeople first, power users under the hood.** Defaults must work for someone who has
  never heard of a key or a relay. Every stronger-or-different choice is a **visible-but-
  optional dial, never a prerequisite**; when a security default would add a hoop for a
  layperson, the hoop becomes opt-in. Reasoning: `plans/encryption/model.md` §1.
- **Interact like a typical centralized SaaS app — with better protections underneath.** The
  mechanism must serve that mental model, not leak through it. A user should **not have to
  manage multiple accounts** on one device or relay: *one identity, one credential set* — a
  password plus its recovery backstop, the familiar arrangement, not several coequal secrets.
- **The recovery phrase is a backstop, not a ritual.** Shown once, in the role every SaaS
  user already understands: *forgot password*.
- **An account is invited, never required.** Single-device, local-only use is fully
  layperson-complete with no account at all; the invitation arrives once there is data worth
  protecting. A nudge, never a wall — see [`@leapsake/reminders`](packages/reminders/README.md).

> ⚠️ **Pre-v0.1 latitude** *(owner, 2026-07-27)*: **breaking changes that cost a new dev
> install are fine.** There are no real users, so a migration is worth writing only when it
> is genuinely cheaper than "delete the profile and relaunch" — prefer the simpler code.
> **This expires at v0.1.** Until then it is why several stores, key formats and door layouts
> were replaced rather than migrated.

## Data model

The domain is people, pets, tags, a relationship graph with derived kinship and dismissals,
milestones, typed contact methods, holidays and observances, reminders, gifts, and the V3
account/key/sync tables. **The forward-only migrations in `packages/data/src/migrations.ts`
are the current shape; the Zod schemas in `packages/schema/src` are the current types.** Read
those — a summary here would be one more thing to keep in step, and would lose.

The conventions they follow are asserted, not described:
`apps/desktop/test/integration/schema-conventions.test.ts` proves the `TEXT` `id` primary
key, the `INTEGER` epoch-ms `created_at`/`updated_at`/`deleted_at` stamps, `snake_case`, and
the absence of `CHECK` constraints. Its header explains why each rule exists.

Two things that test cannot prove, and you must hold:

- **Never hard-delete a row.** A hard delete cannot replicate — a row that is simply gone is
  indistinguishable from one a device has not seen yet — so a tombstone (`deleted_at`) is the
  only durable way to say "gone". The column is checked; *using* it instead of `DELETE` is on
  you.
- **Primary keys are client-generated UUIDs, and must be deterministic** (content- or
  key-derived) wherever two offline devices could assert the same fact. Otherwise they mint
  two rows that collide on a partial unique index at sync time.

## User-visible text

Leapsake will be localized. Two rules, and they apply to new UI code **now** rather than at
translation time, because they are far cheaper to keep than to retrofit:

1. **No component contains a user-visible string.** In `packages/ui`, primitives take text as
   props and everything above them reads the catalog (`@leapsake/ui/messages`). Elsewhere,
   keep strings at the top of a module so the later sweep is mechanical.
2. **Never build a sentence out of fragments.** No `` `${name} (hidden)` ``, no
   `" · with " + label`, no `parts.join(", ")`, no `count === 1 ? … : …` in a component. A
   message that takes values is a **function the catalog owns**, so plural rules, word order
   and list separators belong to the language rather than to render code.

Dates and numbers already go through `toLocaleDateString`/`toLocaleString`; keep it that way.
The full reasoning, and the two known gaps, are in [`packages/ui/README.md`](packages/ui/README.md) → *Text*.

## Two traps specific to working here

### `pnpm test` cannot complete in a sandboxed agent shell

The failure looks like a broken repo rather than a missing network. `test:node` and
`test:coverage` both start with `scripts/ensure-sqlite-abi.mjs`, which shells out to
`prebuild-install` — a network fetch. Sandboxed, it is **SIGKILLed mid-run, which can delete
the native binary on its way out.** Both tiers then FAIL while the static tiers pass.

Instead: run the tiers that need no native module, and run Vitest **directly**.

```sh
pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle
pnpm exec vitest run     # after restoring the binary, below
```

**Never "fix" `ensure-sqlite-abi.mjs` to work around this.** It is correct, and on a
developer machine with network `pnpm test` runs the whole trophy as designed.

### The native SQLite ABI, and how it bites

The single native `.node` carries one ABI at a time, and it is loaded from **two** runtimes:
Electron (the app) and Node (Vitest). **Running the desktop app — `pnpm dev`, `pnpm start` —
flips it to the Electron ABI**, and the next `vitest` run then dies with dozens of *"Worker
exited unexpectedly"* rather than an honest ABI error. A bare `require()` still succeeds, so
the failure is delayed and misleading. It has been observed already flipped in sessions where
the dev app was never started, so check before trusting a green run.

**Which ABI is installed is a file-size check**, since both builds share a name:

| Bytes | ABI |
|---|---|
| `2217120` | Node — what Vitest needs |
| `2217808` | Electron — what the app needs |

Restore the Node build by extracting the cached prebuild — **not** with `prebuild-install
--force`, which can clear the cache before its own download is killed:

```sh
cd node_modules/better-sqlite3-multiple-ciphers
tar -xzf ~/.npm/_prebuilds/*better-sqlite3-multiple-ciphers-*-node-v137-darwin-arm64.tar.gz
```

`pnpm test:bundle` does **not** flip the ABI, despite building the renderer: electron-vite
externalizes the module and never loads it. The whole dance disappears if the N-API fork ever
releases — see [`plans/v0-2.md`](plans/v0-2.md) → *The N-API exit*.
