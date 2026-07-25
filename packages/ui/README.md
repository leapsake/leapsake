# `@leapsake/ui`

Shared, **strictly presentational** UI. Components here take their data as props,
render markup, and get the two things they can't supply themselves — navigation
and form submission — from an adapter the host app injects. They never read a
router, never call `window.api`, and never own a write.

The point is that `apps/web` (post-launch) is a port rather than a rewrite, and
that desktop's UI becomes testable for the first time. Build plan and remaining
increments: [`plans/ui-extraction.md`](../../plans/ui-extraction.md).

## Three subpaths, deliberately

| Import | Holds | Platform |
|---|---|---|
| `@leapsake/ui/tokens` | Design tokens as plain objects | Neutral |
| `@leapsake/ui/headless` | Behavior hooks with zero DOM | Neutral |
| `@leapsake/ui/web` | DOM components | Web + Electron renderer |

There is **no package root export**. Subpaths are what would let a
`./native` renderer be added later without DOM code entering a React Native
bundle's module graph — and they make it obvious at every call site which layer
is being used. Tokens are plain data (not CSS variables, not `StyleSheet`) for
the same reason: that's the one layer both renderers could share unchanged.

## The adapter contract

Two members, and it is meant to stay small — this is the whole surface a new
client has to implement.

```tsx
import { UiProvider, type UiAdapter } from "@leapsake/ui/web";

const adapter: UiAdapter = {
  Link: ({ href, children, ...rest }) => <Link to={href} {...rest}>{children}</Link>,
  Form: ({ method, action, children }) => <Form method={method} action={action}>{children}</Form>,
};

<UiProvider adapter={adapter}>{app}</UiProvider>;
```

- `Link` takes **`href`**, the HTML name, not react-router's `to`. The adapter
  maps it. This keeps the contract satisfiable by whichever framework the web app
  lands on.
- `Form` **must** render a real `<form>` with `method`/`action` intact. The no-JS
  floor the web app owes ([`plans/encryption/model.md`](../../plans/encryption/model.md)
  §10) is precisely the case where no adapter JavaScript runs and the browser
  posts the form itself.
- `useUi()` throws when no provider is mounted rather than falling back to a
  plain `<a>` — a silent fallback renders a full-page navigation that looks fine
  in development and drops the router in production.

Everything else a component needs — loaded data, `submitting`, write callbacks —
arrives as **props**, because it is per-screen state the container already holds
rather than ambient chrome.

## React is a peer dependency

Never a direct one. Desktop and mobile run deliberately different React versions
(`AGENTS.md` → *React version policy*), and a `dependency` here would put a second
physical React in desktop's bundle, whose module-level hook dispatcher then throws
“Invalid hook call”. The regression guard is
`pnpm --filter @leapsake/desktop check:bundle`; run it after touching this package's
deps.

The pinned `react`/`react-dom` pair in `devDependencies` exists only so this
package's own tests render against a matching pair — the workspace root hoists
mobile's `react` alongside desktop's `react-dom`, which do not match.

## Tests

Component tests run under the root Vitest with `@testing-library/react` and a
`jsdom` environment (declared per-file via a `@vitest-environment jsdom` docblock,
so every other tier stays on `node`). `pnpm test` runs them.

They are the reason the extraction is safe: before this package existed, the
desktop renderer had **no** test coverage of any kind, which is explicitly why
three near-identical combobox implementations were left un-deduplicated.
