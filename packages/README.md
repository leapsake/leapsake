# `packages/` — the shared layer

Everything under `apps/` is a client. Everything here is code those clients share, wired in
one direction:

```
schema  →  data  →  core  →  clients
```

- **[`schema`](./schema/README.md)** — Zod schemas → inferred types, plus pure portable
  domain logic (formatters, role algebra, normalization, search folding). Zero platform deps.
- **[`data`](./data/README.md)** — the `SqliteDriver` port, the migration runner, per-entity
  repositories, cross-repo services, and the sync substrate. Imports no DB driver.
- **[`core`](./core/README.md)** — the client-agnostic `CoreApi` every client wires up. It is
  the composition root: it owns the syncable-repo allowlist and the relay wiring, and it is
  the only package that depends on the others.
- **Everything else is a narrow package `core` composes** — `ls` this directory for the list,
  and read each one's own `README.md` for why it is shaped the way it is. Those READMEs are
  the authority; nothing here keeps a second copy of them.

**New domain logic gets its own package**, with injected ports, rather than a new folder
inside `core`. `core` is where things are composed, not where they are implemented.

Client-specific logic belongs in that client's `apps/` project. Anything two clients could
share belongs here.

## These packages run on the Hermes floor

`packages/*` execute on mobile's Hermes engine as well as on Node and Electron, and Hermes
lags on newer JS. Two consequences, both learned the hard way.

**The standard library is capped.** Every package extends
[`tsconfig.packages.json`](../tsconfig.packages.json), which sets `lib` to ES2022 — so an
ES2023-only call (`Array#toSorted`, `toReversed`, `with`, `toSpliced`, `Object.groupBy`) is a
typecheck error here rather than a crash on a device. Use `[...arr].sort(...)`. This is also
why `unicorn/no-array-sort` is off in `.oxlintrc.json`: its suggested fix is the one thing
that cannot ship. Raise the cap only when the Hermes in mobile's pinned Expo SDK genuinely
supports the newer level. `apps/*` are not capped — they target one runtime each and are free
to use what it has.

**Host capabilities are established at each app's entry, not wrapped in here.** Shared code
assumes the `crypto.randomUUID` Web Standard exists. Hermes ships *no* global `crypto`, so
`apps/mobile/index.ts` builds one from `expo-crypto` — native v4, canonical lowercase, so it
is format-identical to Node/desktop and browser/web and primary keys stay
platform-indistinguishable for sync. A shared package should be able to call the standard
thing; making the platform provide it is the app's job.

> Adding or removing a native module needs a Metro `--clear` restart.

## Some shipped code is deliberately unreachable

A feature can be finished and still held back from a release by a flag in
[`@leapsake/flags`](./flags/README.md) — today that is `multiDevice`, which shuts every door
to relay sync for v0.1. If a surface you expect to find is missing from the running app,
check there before concluding it was never built; that README lists the gates and how to flip
a switch for a session.
