# Leapsake — Testing (start here)

This folder is the **design home for how Leapsake tests itself** across every app and package —
the stable *why/how*. It is **not** a status board: what is in flight is in
[`status.md`](../status.md), and what was delivered is in `git log`. The one piece of unbuilt
work this folder still owns is the **E2E tier**, blocked pending owner sign-off on
[`strategy.md`](./strategy.md) §3.

## Which doc for your task

| If you're… | Read |
|---|---|
| making any testing judgment call | the **principles** below — they decide tools |
| adding or understanding a test tier, or touching the `SqliteDriver` contract | [`strategy.md`](./strategy.md) — the layer model + the driver-contract keystone + the E2E release-gate policy |
| working on **mobile** testing (the driver, the emulator tier, the harness) | [`mobile-engine.md`](./mobile-engine.md) — why the native engine can't run headless, and the resulting tier + tool choice |
| building **E2E** flows on any platform | [`crucial-flows.md`](./crucial-flows.md) — the tool-agnostic flow catalog every harness implements |

## Principles (the lens every decision is judged against)

Owner-articulated. Each one *cuts options* — they decide tools, they aren't slogans.

1. **Automate over manual.** A manual check is a temporary bridge, never a destination.
2. **Match production as closely as possible.** Signal strength scales with runtime fidelity; a
   different engine/bundler/module-graph than ships is a *smell*. (This one rule rejects both
   mocked SQLite and WASM SQLite for the mobile driver — see [`mobile-engine.md`](./mobile-engine.md).)
3. **Test what's observable to the consumer.** Assert only on the surface the thing's *consumer*
   sees — a port's return values, a package's public API, text/pixels on screen — never internals.
4. **As blackbox as possible.** Drive the subject through its real boundary; don't reach inside.
5. **Full trophy, every app and package.** Static + unit + integration + E2E each have a home for
   each app and package — not just desktop.
6. **Everything reachable from the dev machine — or a documented, vendor-neutral host for the
   platform.** No hosted CI is assumed. **Carve-out:** native-platform E2E is intrinsically
   multi-host (a prod-faithful Windows/Linux run can't happen on an Apple-silicon Mac), so a
   platform's E2E gate is *blocked* — not waived — until its host exists.
7. **Incremental, no middling-confidence hacks.** Reorder freely to lay the best next brick;
   don't ship a shortcut that only buys partial confidence.

## The one rule

These are design docs. When work lands, record it in [`status.md`](../status.md); keep these
stable.
