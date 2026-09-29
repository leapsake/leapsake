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
  the composition root: it constructs the repositories, calls each feature package's
  `createXApi(deps)`, owns the syncable-repo allowlist and the read-and-compose view builders,
  and is the only package that depends on the others.
- **Everything else is a narrow package `core` composes** — `ls` this directory for the list,
  and read each one's own `README.md` for why it is shaped the way it is. Those READMEs are
  the authority; nothing here keeps a second copy of them.

**New domain logic gets its own package**, with injected ports, rather than a new folder
inside `core`. `core` is where things are composed, not where they are implemented.

A feature package takes the repositories it needs as a `deps` object typed against the
interfaces in `data`, exactly as `createHolidaysApi` and `createRemindersApi` do. Depending on
`data` for those types is normal. **Depending on `core` is not, ever** — nothing enforces that
mechanically, but a real cycle would break `tsc`, and the arrows above are the design.

Where a port would close a loop, it stays a port: `reminders` takes `listHolidayCandidates`
rather than importing `holidays`, which already depends on it.

Client-specific logic belongs in that client's `apps/` project. Anything two clients could
share belongs here.

## Consumed as raw TypeScript

No package here has a build step. Each ships its `.ts` source and imports its siblings with
ESM `.js`-suffixed specifiers (`from "./person.js"`) under `moduleResolution: "bundler"`, and
each app's bundler resolves those to the `.ts` file on disk. Two consequences:

- **Desktop bundles them rather than externalizing them.** An externalized package would be
  loaded by Electron's Node straight from its `.ts` source and fail on those specifiers, so
  `apps/desktop/electron.vite.config.ts` excludes every `@leapsake/*` in its `dependencies`
  from `externalizeDepsPlugin`, and a new package is covered with no edit there.
- **Mobile's Metro retries a relative `.js` import as `.ts`, then `.tsx`,** because Metro
  honours an explicit extension. Real `.js` files in `node_modules` resolve on the first try,
  so the retry only fires for this source. `apps/mobile/metro.config.js` also watches the repo
  root and resolves from both the app's and the root's hoisted `node_modules`.

A package that is ever consumed outside a bundler (plain Node, another repository) needs its
own build: `tsc` emitting `dist/*.js` and types, with `exports` pointing at the output.

## These packages run on the Hermes floor

`packages/*` execute on mobile's Hermes engine as well as on Node and Electron, and Hermes
lags on newer JS and has bugs of its own. Three consequences, all learned the hard way.

**The standard library is capped.** Every package extends
[`tsconfig.packages.json`](../tsconfig.packages.json), which sets `lib` to ES2022 — so an
ES2023-only call (`Array#toSorted`, `toReversed`, `with`, `toSpliced`, `Object.groupBy`) is a
typecheck error here rather than a crash on a device. Use `[...arr].sort(...)`. This is also
why `unicorn/no-array-sort` is off in `.oxlintrc.json`: its suggested fix is the one thing
that cannot ship. Raise the cap only when the Hermes in mobile's pinned Expo SDK genuinely
supports the newer level. `apps/*` are not capped — they target one runtime each and are free
to use what it has.

**Host capabilities are established at each app's entry, not wrapped in here.** Shared code
assumes the `crypto.randomUUID` Web Standard exists. Hermes ships _no_ global `crypto`, so
`apps/mobile/index.ts` builds one from `expo-crypto` — native v4, canonical lowercase, so it
is format-identical to Node/desktop and browser/web and primary keys stay
platform-indistinguishable for sync. A shared package should be able to call the standard
thing; making the platform provide it is the app's job.

**Hermes miscompiles more than one `await` in one ternary branch.** The branch comes back as a
leftover number; Node and the desktop bundler compile the same source correctly, so only a
device sees it. [`scripts/hermes-await-in-ternary.test.mjs`](../scripts/hermes-await-in-ternary.test.mjs)
bans the shape, and its header names the Expo SDK last checked. **Re-check on each SDK bump:** a
throwaway module imported from `apps/mobile/index.ts` that logs the shape at two and four
awaits, read on the dev client with `xcrun simctl spawn booted log stream`. When both come back
right, delete the scan and its `vitest.config.ts` include.

> Adding or removing a native module needs a Metro `--clear` restart.
