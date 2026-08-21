# @leapsake/flags

The release switches that hold a finished feature back from a release without
deleting it. One flag today: `multiDevice`, which shuts the doors on relay sync
for v0.1.

Zero dependencies, because `ui`, `reminders`, `core`, and both clients all read
flags and `ui` cannot import `core` — only a leaf can serve all of them. Nothing
that pulls in a workspace package may be added here.

## Surface

- `flag(name)` — is it on?
- `flagSnapshot()` — every flag resolved, for crossing a process boundary or
  rendering a dev menu.
- `setFlagOverrides(overrides)` — the environment layer, set once at a client's
  entry point.
- `setLocalFlagOverrides(overrides)` — the device-local layer, reserved for a
  future dev menu.
- `parseFlagOverrides(spec)` — `"multiDevice"` / `"multiDevice=false"`, comma-
  or whitespace-separated. Throws on an unknown name.
- `withFlags(overrides, run)` / `resetFlagOverrides()` — for tests.

Resolution is local → environment → default, and the two override layers stay
separate so that clearing the local one falls back to the environment rather
than to the shipping default. That is what "reset this toggle" has to mean.

## Turning a flag on while developing

```
LEAPSAKE_FLAGS=multiDevice pnpm desktop
EXPO_PUBLIC_LEAPSAKE_FLAGS=multiDevice pnpm mobile
```

The two variable names differ because Metro _textually_ inlines
`process.env.EXPO_PUBLIC_*` and nothing else — a variable read through any other
name resolves to `undefined` in a React Native bundle. That is also why this
package never touches `process.env` itself: each client parses its own idiom and
calls `setFlagOverrides`. Mobile reads it only under `__DEV__`, so a release
build cannot be talked into a flag.

Desktop's main process reads the variable and passes `flagSnapshot()` to the
renderer over the existing preload bridge, so the two halves cannot disagree
about a flag mid-session.

## Where the gates are

The rule is **one gate per surface, at the point that makes the feature
unreachable** — not a check at every leaf that touches sync. For `multiDevice`
that is five places:

| Where                                                                | What it shuts                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/{desktop,mobile}` Settings                                     | Enabling sync, joining an account, merging, "Sync now", the auto-sync toggle |
| `packages/reminders/src/engine.ts`                                   | The "already have Leapsake on another device?" nudge on Home                 |
| `apps/desktop/src/main/index.ts`, `apps/mobile/lib/core-context.tsx` | The background sync scheduler's run thunk                                    |

The IPC channels, repositories, and `packages/sync` itself are untouched.
Unreachable is the goal, not absent.

## Testing a gated feature

Tests run at shipping defaults, so `pnpm test` proves what a v0.1 user can
actually reach. A test for the _on_ side opts in explicitly:

```ts
await withFlags({ multiDevice: true }, () => …);
```

This is the part that keeps flagged-off code from rotting: a flag whose on-state
is never exercised is a slower way of deleting the feature.

## What this is not

**Not a security boundary.** A flag hides a product surface; `apps/server` still
answers relay requests, and a build whose flag got flipped would sync fine.
Anything that must be _enforced_ belongs on the server.

**Not permanent configuration.** A flag is a holding pattern with an owner and a
release. When the feature ships, flip the default, delete the flag, and delete
its gates in one commit. There is deliberately no expiry field: it would only be
as good as something enforcing it, and the removal is tracked in `plans/` with
the rest of the release's work.
