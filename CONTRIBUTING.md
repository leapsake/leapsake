# Contributing to Leapsake

Leapsake is a privacy-first people-management app. Data lives locally in SQLite and there is
no cloud dependency to use it. It grows desktop → mobile → sync + web, on a shared,
client-agnostic data/core layer.

- **What to work on**: [`plans/status.md`](plans/status.md) is the single status oracle;
  [`plans/README.md`](plans/README.md) is the project map.
- **How the code is arranged**: [`packages/README.md`](packages/README.md) for the shared
  layer, and each app's own README under `apps/`.
- **Conventions and guardrails**: [`AGENTS.md`](AGENTS.md).

## Setup

Node ≥ 24 and pnpm ≥ 10. **pnpm only** — `npm install` is refused by
`devEngines.packageManager`, and `npx` along with it; use `pnpm exec`.

```sh
pnpm install
pnpm desktop     # the Electron app
pnpm mobile      # Expo dev server
```

## Testing

The trophy is orchestrated by [`scripts/test-all.mjs`](scripts/test-all.mjs), which owns the
tier registry and documents its flags and exit codes in its own header. In the inner loop:

```sh
pnpm test        # fast: static + unit + integration + coverage gate. No emulator.
pnpm test:all    # everything reachable; unreachable tiers report ⏳ BLOCKED, never skipped
pnpm test:node   # just Vitest
```

### The principles

These are the lens every testing decision is judged against. Each one *cuts options* rather
than being a slogan, and between them they have already decided our tools.

1. **Automate over manual.** A manual check is a temporary bridge, never a destination.
2. **Match production as closely as possible.** Signal strength scales with runtime fidelity;
   a different engine, bundler or module graph than ships is a *smell*. This one rule rejects
   both mocked SQLite and WASM SQLite for the mobile driver — see
   [`apps/mobile/README.md`](apps/mobile/README.md) → *Why the driver test needs a device*.
3. **Test what's observable to the consumer.** Assert only on the surface the thing's
   *consumer* sees — a port's return values, a package's public API, text and pixels on
   screen — never internals. In practice: the driver adapters → their `SqliteDriver` port's
   return values; a `packages/data` repo → its method results; `packages/core` → `CoreApi`
   results; an **app** → what's on screen.
4. **As blackbox as possible.** Drive the subject through its real boundary; don't reach
   inside.
5. **Full trophy, every app and package.** Static, unit, integration and E2E each have a home
   for each app and package — not just desktop.
6. **Everything reachable from the dev machine** — or a documented, vendor-neutral host for
   the platform. No hosted CI is assumed. **Carve-out:** native-platform E2E is intrinsically
   multi-host (a prod-faithful Windows or Linux run cannot happen on an Apple-silicon Mac), so
   a platform's E2E gate is *blocked* — not waived — until its host exists.
7. **Incremental, no middling-confidence hacks.** Reorder freely to lay the best next brick;
   don't ship a shortcut that only buys partial confidence.

**The consequence that keeps the mobile tier small:** because the repo and service logic is
shared and driver-injected, we do *not* re-prove it per platform. We prove the **driver** is
equivalent — one shared contract suite, run on both engines — and the shared logic's desktop
run carries over.

### Where each tier lives

`scripts/test-all.mjs` is the registry; this is the shape of it.

| Tier | What it proves |
|---|---|
| **Static** | format, lint, typecheck, version agreement, icon agreement, and the renderer-bundle React guard |
| **Unit** | schema validation and pure domain logic, in `packages/schema` |
| **Integration** | every repository and cross-repo service against the **real production desktop engine**, via `makeEncryptedTestDriver` |
| **Component** | `packages/ui`'s presentational components under `@testing-library/react` |
| **Driver contract** | one shared spec pinning every `SqliteDriver` impl to identical observable behavior |
| **Mobile native** | `pnpm test:native` drives the in-app self-test on a booted emulator/simulator via Maestro and asserts PASS from the CLI |
| **E2E** *(blocked)* | the crucial-flow catalog per platform — [`plans/testing/crucial-flows.md`](plans/testing/crucial-flows.md) |

Component tests need two things Vitest does not give them by default, since the suite runs
without globals: a `// @vitest-environment jsdom` docblock, and an explicit
`afterEach(cleanup)`. Assert what a user perceives — roles, text, the `name` a field submits
under — not internals.

## Versioning and releases

**One version across every manifest** in `apps/` and `packages/`, so that iOS `1.2.3` and
macOS `1.2.3` are known to work together. New workspaces join at whatever the repo is on:
`scripts/set-version.mjs` *discovers* manifests rather than listing them, and
`pnpm test:versions` fails the suite when they disagree. Both stores reject a non-numeric
version, so `apps/mobile/app.config.ts` strips any pre-release suffix — the repo runs on real
semver and the stores see the numeric core, distinguished by a clock-derived build number.

> ⚠️ **The number is a promise, not a mechanism.** What actually makes two separately-installed
> artifacts compatible is `@leapsake/schema` migrations, `@leapsake/sync`, and identical
> `@leapsake/flags` state. A flag that differs between two platforms shipped from the same tag
> makes the promise false while the numbers agree.

**`main` is the only long-lived branch.** Branch only when `main` would otherwise be
unreleasable. `release/X.Y.Z` exists for exactly one situation — stabilizing a release while
unrelated work keeps landing — and is deleted once the release ships.

**A release is a tag, and [`scripts/release/`](scripts/release/) is the whole policy.** The
ladder (`alpha` → `beta` → `rc` → final), what each rung requires per platform, and every
precondition are enforced there rather than described here. Read its header for the reasoning;
run `pnpm release --help` for the current rules.

- **A human chooses the rung; the number is computed** from the tags that already exist. The
  one hand-picked number is the base `X.Y.Z`, once per release train (`--base=`).
- Targets are a registry in the same shape as the test tiers, `ready` or `blocked`, so a
  platform that cannot ship is **reported, never silently skipped**. `pnpm release <stage>
  --dry-run` answers "what is this platform waiting on?" without building anything.
- Credentials come from an untracked `.env` (copy `.env.example`). The environment wins over
  the file, so a runner's secrets are never shadowed by a local copy.
- **The script tags and never pushes.** Store version strings are permanent and monotonic, a
  Play closed test starts a 14-day clock at its first upload, and a notarized artifact is
  public the moment its feed sees it — so the irreversible step stays a person's.

## Commit and PR conventions

Small, incremental, independently committable changes that each deliver value on their own.
Large commits create more errors and are harder to revert. Say *why* in the commit message;
the diff already says what.
