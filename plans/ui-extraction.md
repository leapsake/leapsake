# Leapsake UI extraction — `@leapsake/ui` + `@leapsake/view-models`

> **Build doc.** `@leapsake/ui` is **done** — every presentational component the desktop
> renderer had now lives there, tested. What remains is **increment 7**: `@leapsake/view-models`,
> for the derivation logic desktop and mobile still duplicate. Status: [`status.md`](./status.md).
>
> If you are picking up increment 7, read *What's left* and the two *Settled decisions* that bear
> on it; the rest of this file is context for why the package looks the way it does.

## What's left

### Increment 7 — `@leapsake/view-models` (independent of everything above)

**Goal:** stop desktop and mobile maintaining the same derivations twice.

A new package depending only on `@leapsake/schema` (plus `@leapsake/core` **types**) —
deliberately lighter than `packages/core`, whose `views.ts` keeps the view-models that need repo
access.

Extract, with tests, the logic currently duplicated between `apps/desktop/src/renderer/src/**`
and `apps/mobile/components/**`:

- the `IdeaGroup` union-and-sort in `GiftsSection` (byte-identical across clients today),
- the observed/addable split in `HolidaysSection`,
- the open/done partition + CTA mapping in `ReminderList`,
- the given-sinks ordering in `GiftList`.

Then update **both** clients to consume it. Mobile is the proof that the package is genuinely
headless — and the reason to be careful: mobile has no automated UI coverage, so a mistake there
surfaces on a device, not in CI.

Do **not** move trivia like `joinBits`; three duplicated lines are cheaper than a shared home.

**Done when:** both clients import the shared derivations, the package has unit tests, and
`pnpm test` passes. Verify mobile on a booted device or by inspection — these are pure functions.

**Boundary rule** (revisit if it starts needing judgment every time): needs repo/driver access ⇒
`packages/core`; pure derivation over already-loaded data ⇒ `view-models`.

### Also outstanding, outside this plan

- **The design system.** `@leapsake/ui/tokens` grows real values and the components grow styles.
  Pre-v0.1, deliberately *after* this extraction.
- **i18n proper.** The message catalog seam is built; a library and `@leapsake/schema`'s English
  label tables (`genderLabel`, `kindDefs`, the ~40 role labels) are not. Mobile reads those
  directly, so it is a cross-client workstream, not a UI-package task.

## What's done

Increments 0–6 shipped, plus a cross-cutting text pass. `packages/ui` now holds every
presentational component the renderer had, with 197 tests — the first UI coverage this repo has
ever had.

| # | Shipped |
|---|---|
| 0 | Package skeleton, the `UiAdapter` seam, the component test tier (`@testing-library/react` + jsdom) |
| 1 | `Breadcrumbs`, `ConfirmDelete`, the 10 confirm-destructive screens |
| 2 | The combobox trio unified: `useTypeahead` + `useDebouncedSearch` + `Combobox` |
| 3 | Route builders, `Section`/`EmptyState`/`DataTable`/`DetailList`, the 5 read-only sections |
| 4 | `useSerializedWrites`; Holidays; the gift cluster behind `GiftsPorts`; the three view screens |
| 5 | `FormShell` + `Field`, and all seven forms with their field groups |
| 6 | The import overlay; then `SearchBar` and `ReminderText`, emptying the app's `components/` |
| — | **Text pass:** no component contains a user-visible string (see *Settled decisions*) |

**What stays in `apps/desktop` by design:** `router.tsx` (every loader, action and `FormData`
parse), all `window.*` access, `Settings` (1,067 lines of sync/key-custody UI), `RecoveryGate`,
`main.tsx`'s boot gate, and `ErrorPage` (`useRouteError` is router-specific). The remaining
`screens/` are thin containers: read the loader, render a package component.

## Settled decisions (don't relitigate)

- **`@leapsake/ui`, not `components`** — it holds tokens and styles too.
- **No styling during the extraction.** Markup moved unstyled; the visual pass is separate.
  Changing structure and appearance together makes a regression indistinguishable from a redesign.
- **Data-out is the HTML form contract.** Components render `<form method="post">` with named
  fields and never own submit logic. [`encryption/model.md`](./encryption/model.md) §10 makes a
  no-JS SSR path a hard requirement for the web app, and `<Form>`/`useNavigation` is React
  Router's own progressive-enhancement API. Callback submission can be layered on later; the
  semantic form is the floor.
- **No component contains a user-visible string.** Primitives take text as props; everything above
  them reads a typed catalog at `@leapsake/ui/messages`. **A message taking values is a
  function** — the catalog owns whole sentences, so a component cannot assemble one from
  fragments, and plurals/word order/list separators belong to the language. An i18n library
  replaces the catalog and its provider without touching a component. Rules: `AGENTS.md` →
  *User-visible text*.
- **Shared derivations go to `@leapsake/view-models`**, not a `utils` package — a package named
  for its shape rather than its job becomes a junk drawer.
- **React Native beside DOM: door open, not built.** Tokens (plain data) and headless hooks
  already share; props types could. Rendered output cannot. If it happens, add `src/native/`
  behind its own subpath so DOM code stays out of Metro's graph.

## How the package is shaped

```
packages/ui/src/
  tokens/     plain objects — no CSS. Platform-neutral.
  messages/   the typed catalog + its provider. Platform-neutral.
  headless/   behavior hooks + route builders, zero DOM. Platform-neutral.
  web/        DOM components: primitives/ patterns/ sections/ screens/ forms/ fields/ import/
```

Four subpath exports, no package root — that is what would keep DOM code out of a React Native
bundle if `/native` is ever added, and it makes the layer visible at each call site.

**Three seams, and the rule for choosing between them:**

1. **`UiAdapter`** (context) — `Link` and `Form`, the two pieces of app chrome a component can't
   supply itself. `Link` takes `href`, the HTML name, so the contract is satisfiable by React
   Router or Next. `Form` must render a real `<form>`; the no-JS floor depends on it. Deliberately
   two members wide.
2. **Props** — data, `submitting`, and write callbacks. The default.
3. **A feature ports interface** (`GiftsPorts`) — only when components nest deep *and* appear on
   several screens. Gifts qualified: nine functions, three levels, four screens. `HolidaysSection`
   did not, and takes a callback prop. `SearchBar` navigates via an `onNavigate` prop rather than
   growing the adapter; promote it there if a second component ever needs it.

**Types from `@leapsake/core` are declared structurally** rather than imported (`GenderResult`,
`BearerHoliday`, `GivenRow`, `RelationshipCandidate`, `ImportDuplicateMatch`) — core's types stay
assignable and the package stays off the data layer. The exception is `@leapsake/contact-import`,
a real dependency: `ParsedContact` is far too large to restate.

## Constraints that bite

- **React is a `peerDependency`.** A direct dependency puts a second React in desktop's bundle
  ("Invalid hook call"). The workspace root pins a matching `react`/`react-dom` pair at *mobile's*
  version so the component tests render against one — moving it would push mobile off the hoisted
  copy into a nested case Metro doesn't handle. Guard: `pnpm --filter @leapsake/desktop
  check:bundle`, **after any change to React deps**.
- **`check:bundle` flips the SQLite native binary to the Electron ABI**, and the flip is delayed
  enough that the suite can pass immediately afterward and fail later. Restore with the `tar`
  command in `plans/…` / the project memory before trusting a test run.
- **No build step.** Packages export raw `./src/*.ts`; desktop's bundler config needs nothing. The
  package therefore ships `.tsx` and `.module.css` as source and carries its own
  `css-modules.d.ts`.
- **Vitest**: component tests are `.tsx` (the root include covers both), opt into jsdom per file
  with `// @vitest-environment jsdom`, and need an explicit `afterEach(cleanup)` — the suite runs
  without globals, so Testing Library can't register its own.

## Open questions

- **Web framework** — must support SSR/no-JS *and* client-side decryption. Doesn't block
  increment 7; it decides whether the `Form` adapter wraps React Router's `<Form>` or a server
  action.
- **CSS strategy.** CSS Modules work under Vite for a source-only workspace dep; Next.js would
  need `transpilePackages`. Another reason styling waits for the framework decision.
