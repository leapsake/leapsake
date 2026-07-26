# Leapsake UI extraction — `@leapsake/ui` + `@leapsake/view-models`

> **Build doc** — how the desktop renderer becomes a shared, strictly-presentational UI
> package that the future web app (`apps/web`) can consume, plus a headless package for the
> derivation logic desktop and mobile already duplicate. Nothing is built yet. Status /
> sequencing: [`status.md`](./status.md). The web app itself is post-launch (§*Post-launch*
> there) — **this work is not**: it is a refactor of shipped desktop code that stands on its
> own, and it is what makes the web app a port rather than a rewrite.
>
> Read this file top to bottom before starting an increment. The survey in *Where the code
> is today* is the context a fresh agent would otherwise have to rebuild by hand.

## Why

Two separate problems, two packages.

1. **The desktop renderer can't be reused.** 60 of its 71 component/screen files import
   `react-router-dom`, and 12 call `window.api` directly. A web app would re-implement all
   of it. The fix is a presentational package with the framework couplings inverted into
   injected props — which also gives desktop its first component-test coverage.
2. **Desktop and mobile duplicate derivation logic verbatim.** The gift grouping/ordering,
   the observed/addable split, the open/done reminder partition. That is not a DOM problem
   and can't live in a DOM package — it gets its own headless one, which all three clients
   (desktop, mobile, web) share.

`@leapsake/ui` is also intended as **the eventual home for Leapsake's design system** —
tokens, styles, and shared visual language. That is a *later* increment (pre-v0.1, but not
part of this extraction); see *Post-v0.1 doors*.

## Owner decisions (settled — don't relitigate)

- **Package name: `@leapsake/ui`**, not `components` — it will hold tokens and styles, not
  just components.
- **No styling during extraction.** Markup moves unstyled; the visual layer is a separate
  pre-v0.1 pass. Changing structure and appearance at once on a 60-file refactor with no
  existing component tests makes a regression indistinguishable from a redesign.
- **Data-out is the HTML form contract (“Option A”).** Presentational components render
  `<form method="post" action=…>` with named fields and never own submit logic. Callback-style
  submission (`onSubmit`) may be layered on later for specific surfaces, but the semantic form
  is the default and the floor. Rationale: [`encryption/model.md`](./encryption/model.md) §10
  makes a no-JS SSR path a hard requirement for the web app; `<Form>` / `useNavigation` is
  React Router's own progressive-enhancement API, and Next's server actions can sit behind the
  same injected-component seam. Option B first would discard the no-JS floor before the web app
  exists.
- **Per-slice two-step refactor.** Every increment that moves code is **two commits**:
  (A) split container from presentational *in place*, in `apps/desktop`, app still building and
  behaving identically; (B) move the presentational half to `@leapsake/ui` and rewrite imports.
  Commit A is reviewable in context and is an improvement on its own; commit B is a near-pure
  move. Doing both at once produces diffs nobody can review.
- **React Native components beside DOM ones: door left open, not prioritized.** See
  *Post-v0.1 doors*. It costs nothing now if tokens are plain data and behavior hooks are
  headless; both are required by the increments below anyway.
- **Shared derivations go to `@leapsake/view-models`**, not a `utils` package. A package named
  for its shape rather than its job becomes a junk drawer and can't have a README that explains
  why it's shaped that way.
- **No component contains a user-visible string** (decided 2026-07-25, built the same day).
  Localization is coming, so primitives take text as props and everything above them reads a
  typed catalog at `@leapsake/ui/messages`. A message taking values is a **function** the catalog
  owns, which is what makes a component unable to assemble a sentence out of fragments. A
  dedicated i18n library replaces the catalog and its provider later; no component changes.
  Rules in `AGENTS.md` → *User-visible text*; rationale in the package README.

## Where the code is today

`apps/desktop/src/renderer/src/` — 28 `components/`, 43 `screens/`, 2 `import/`, plus
`router.tsx` (1,539 lines) holding **every** loader and action in the app.

### Styling barely exists

Three CSS modules, 215 lines total, all overlay positioning for comboboxes
(`SearchBar.module.css`, `MultiAddCombobox.module.css` — the latter a literal copy of the
former — and `ImportOverlay.module.css`), plus a handful of inline `style={{ color: "#666" }}`.
The UI is deliberately unstyled semantic HTML. **This extraction is a structure/behavior port,
not a design-system port.**

### Four kinds of coupling, needing different surgery

| Coupling | Files | Shape |
|---|---|---|
| Nav — `<Link to=…>` | 43 | Paths are already computed strings — the easiest seam |
| Data-in — `useLoaderData() as {…}` | 37 | Screens read from the router, not from props |
| Data-out — `<Form method="post">` + `useNavigation()` | 26 / 22 | Writes go to actions in `router.tsx`; also `useFetcher` (4), `useRevalidator` (6) |
| Direct IPC — `window.api.*` | 12 | Bypasses the router entirely |

The direct-IPC files are `HolidaysSection`, `GiftsSection`, `GiftIdeaRecipientsSection`,
`GiftAdornmentsEditor`, `GiftOccasionFields`, `GiftCaptureForm`, `SearchBar`,
`MentionTextField`, `HolidayView`, `ImportReview`, `RecoveryGate`, `Settings`. Several
independently re-implement the same serialized-write queue (an `inFlight` promise ref +
`busy` + `error` + `revalidate()`); that logic is generic and becomes one headless hook.

### Patterns repeated enough to extract

1. **Section shell** — `<section><header><h2>Title</h2>{action}</header>{empty ? <p/> : <table|ul>}</section>`
   — verbatim in all 8 `*Section.tsx` files, plus `TagView` / `HolidayView` / `Settings`.
2. **Confirm-destructive screen** — 10 files, identical modulo prose.
3. **Data table with a trailing actions column** — Milestones, Relationships, ContactMethods,
   Holidays, EntityList, TagView, Duplicates.
4. **The combobox, three times** — `SearchBar`, `MultiAddCombobox`, `MentionTextField` each
   re-implement the same ARIA contract, arrow/Enter/Escape handling, `aria-activedescendant`,
   the mousedown-before-blur trick, the 2-char floor, the 200 ms debounce, latest-query-wins
   tokens, and a visually-hidden live region. The duplication was left visible *deliberately*
   (see the header comment in `MultiAddCombobox.module.css`) because there was no
   component-test tier to catch a regression in the shipped surfaces. **This increment removes
   that objection** — the tier lands in Increment 0.
5. **Form shell** — `<Form method="post">` + header with `h1` / submit / Cancel +
   `<fieldset disabled={submitting}>`, across all 7 form components.
6. **Empty states** — 14 distinct “No X yet.” strings, all bare `<p>`.
7. **Labeled field rows** — `<label>Name <input/></label>` everywhere.
8. **Detail `<dl>`** — `PersonView`, `PetView`, `RelationshipView`.

### Already pure — portable with no surgery

`GenderField`, `GenderValue`, `ReminderScheduleFields`, `WithWhomFields`, `MultiAddCombobox`,
`lib/highlightMatch.tsx`.

`lib/highlightMatch.tsx` is the **model to copy**: platform-agnostic segments computed in
`@leapsake/highlight`, a five-line React renderer in the app. Every extraction here is a
variation on that split.

### `DropImportProvider` is already portable

Worth knowing because it looks Electron-specific and isn't: it contains **zero Electron API**.
It's HTML5 `dragover`/`dragenter`/`dragleave`/`drop` on `window`, `dataTransfer.files`, and
`file.text()`, feeding the pure `@leapsake/contact-import` parser. The one load-bearing
subtlety — `preventDefault` so the window doesn't navigate to the dropped `file://` URL — is
Chromium behavior, identical in a browser tab. Only `ImportReview` needs work (it calls
`window.api.import.*` and uses `useNavigate`/`useRevalidator`).

## The target shape

```
packages/ui/
  src/
    tokens/      # plain JS objects (color, space, type). No CSS. RN-consumable.
    headless/    # behavior hooks, zero DOM: useTypeahead, useSerializedWrites. RN-consumable.
    web/         # DOM components: primitives/, patterns/, sections/, forms/
  package.json   # exports: "./tokens", "./headless", "./web"  ·  react as peerDependency
```

Subpath exports (rather than one barrel) are what keep DOM code out of a React Native bundle's
module graph if `/native` is ever added. `react` **must** be a `peerDependency`, never a
`dependency` — see *Constraints* below.

### The injection contract

Two ambient chrome components come through context; per-screen state comes through props.

```ts
// packages/ui/src/web/adapter.tsx
export interface UiAdapter {
  /** Client-side navigation. Prop is `href` (HTML-neutral); the desktop adapter maps to
   *  react-router's `to`. Keeps the contract satisfiable by React Router or Next. */
  Link: ComponentType<{ href: string; children: ReactNode; [k: string]: unknown }>;
  /** Must render a real <form> with method/action intact — the no-JS floor depends on it. */
  Form: ComponentType<{ method: "post"; action?: string; children: ReactNode }>;
}
```

`submitting` is passed as a **prop**, not read from context: it is per-screen state the
container already holds (`useNavigation().state === "submitting"`), and keeping it out of
context leaves the package's form components hook-free for that concern.

Route **path derivation is app policy, not presentation.** `entityBasePath`, and
`RelationshipsSection`'s `editPath`/`removePath`/`derivedQuery` explicit-vs-derived branching,
move to a shared pure path-builder module — not into presentational components. Desktop and web
use the same paths (desktop's `createHashRouter` changes only how they're serialized), so that
module is shareable; put it in `@leapsake/ui/headless` alongside the behavior hooks.

## Constraints that will bite

- **React single-instance.** `@leapsake/ui` is the first React-consuming workspace package,
  landing directly on the policy in [`../AGENTS.md`](../AGENTS.md) (“React version policy”).
  Declare `react` as a `peerDependency`; a `dependency` gives desktop a second physical React
  and the “Invalid hook call” / null-dispatcher crash. Desktop's existing
  `pnpm --filter @leapsake/desktop check:bundle` guard catches the regression — **run it after
  every increment.** (Desktop runs `react@19.2.7`; mobile is Expo-pinned to `19.2.3`. The
  divergence is intentional and is exactly why the peer dep matters.)
- **No build step.** Workspace packages export raw `./src/index.ts`;
  `apps/desktop/electron.vite.config.ts` already derives its bundle-don't-externalize list from
  `dependencies`, so a new `@leapsake/*` dep needs **zero** desktop bundler config. Consequence:
  the package ships `.tsx` and `.module.css` as source, so it needs its own copy of the
  `css-modules.d.ts` shim (currently `apps/desktop/src/renderer/src/css-modules.d.ts`).
- **Vitest's include pattern is `.ts` only.** Root `vitest.config.ts` has
  `packages/*/{src,test}/**/*.test.ts`. Component tests are `.tsx` — the pattern must be widened,
  and the package's tests need `environment: "jsdom"` (per-file `@vitest-environment jsdom`
  docblock, or a projects/workspace entry) while everything else stays on `node`.
- **Dependency budget.** `@testing-library/react` + `jsdom` are genuine additions
  (`@testing-library/dom` is present in `node_modules` only as a hoisted transitive of Expo
  tooling — not a declared dep, don't rely on it). The justification is real and should be
  recorded in the AGENTS.md budget section: there is currently **no** renderer test coverage of
  any kind, and this is a 60-file refactor of shipped UI.
- **The tsconfig-include invariant** (AGENTS.md → Testing): a new test directory must sit under
  some project tsconfig's `include`, or `pnpm test:types` silently skips it.

## Increments

Each is independently shippable and independently valuable. Increments 1–6 assume 0. **7 is
independent of all of them** and can be picked up at any time by anyone.

Remember the per-slice two-step rule: commit A splits in place, commit B moves.

### 0 — Package skeleton, seams, and the component test tier

**Goal:** prove the whole loop end to end on code that needs no refactoring.

- Create `packages/ui` with the layout above; `react` + `react-dom` as `peerDependencies`;
  `typecheck` script matching the other packages; a `README.md` stating the package's job (the
  injected-adapter contract, why tokens are plain data, why subpaths exist).
- Define `UiAdapter` + a `UiProvider` in `src/web/adapter.tsx`. Write the desktop adapter in
  `apps/desktop` mapping `href`→`to` for `react-router-dom`'s `Link` and passing `Form` through.
  Mount it in `App.tsx`.
- Seed `src/tokens/` from the palette already in `apps/mobile/lib/styles.ts` (plain objects, no
  CSS). Nothing consumes it yet — this establishes the layer and its shape.
- Move the three genuinely-pure things as proof: `GenderField`, `GenderValue`, and the React
  renderer half of `lib/highlightMatch.tsx`.
- Add `@testing-library/react` + `jsdom`; widen the vitest include to `.tsx`; wire the jsdom
  environment; write the first component tests against the three moved components.

**Done when:** `pnpm test` passes, `pnpm --filter @leapsake/desktop check:bundle` reports exactly
one `react`/`react-dom`, and `pnpm desktop` runs with no visible change.

### 1 — Breadcrumbs + `ConfirmDelete` + the 10 confirm-destructive screens

**Goal:** the highest duplication-to-risk ratio in the codebase; validates the two-step rule on
real screens.

- `src/web/primitives/Breadcrumbs.tsx` — from `components/Breadcrumbs.tsx`. `homeCrumb`
  hardcodes `/people`, so it stays in the app (`lib/crumbs.ts`) rather than becoming a package
  constant: which route is home is a client decision.
- `src/web/patterns/ConfirmDelete.tsx` — breadcrumbs slot, heading, prose slot,
  `<Form method="post">` + `<fieldset disabled={submitting}>` + submit + cancel link, plus a
  `hiddenFields` record for the inferred-relationship dismiss.
- Migrate: `ContactMethodDelete`, `GiftIdeaDelete`, `MilestoneDelete`, `PersonDelete`,
  `PetDelete`, `RelationshipDelete`, `RelationshipDismiss`, `RelationshipRowDelete`,
  `ReminderDelete`, `TagDelete`. Each keeps a thin app-side container that reads the loader and
  renders the pattern.
- Add an app-side `useSubmitting()` (`useNavigation().state === "submitting"`), so `submitting`
  can be a prop at every call site without ten hand-written copies.

`Section` / `EmptyState` / `DetailList` were originally listed here and moved to increment 3,
where their first consumers live — shipping unconsumed primitives would be guessing at their
shape.

**Done when:** all 10 screens render and delete correctly; the pattern has tests covering the
disabled-while-submitting state, the hidden fields, and the cancel path.

### 2 — The combobox trio

**Goal:** collapse three hand-maintained copies of the same ARIA/keyboard contract into one.

- `src/headless/useTypeahead.ts` — query state, min-chars floor, debounce, latest-query-wins
  token, active-index movement, open/closed. Takes an injected async `search` function so it has
  no IPC or DOM dependency. Zero DOM ⇒ RN-consumable later.
- `src/web/primitives/Combobox.tsx` — the input + listbox markup, ARIA wiring,
  mousedown-before-blur, the live region. Carries the (currently duplicated) stylesheet, now
  once.
- Rewrite `SearchBar`, `MultiAddCombobox`, and `MentionTextField` as thin callers.
  `MentionTextField` keeps its caret/fragment detection and the `@`-vs-`#` branch locally —
  that's genuinely its own logic — but stops owning the list machinery. `SearchBar` keeps
  `pathFor` and navigation in the app.

**Done when:** all three surfaces behave identically by hand-check (type, arrow, Enter, Escape,
mouse-pick), and the shared component has tests for the keyboard contract and the
stale-response guard. Delete the duplicated stylesheet.

### 3 — Read-only sections + the path-builder module

- `src/headless/routes.ts` — `entityBasePath` and the relationship explicit-vs-derived path
  helpers, as pure string functions with tests.
- `src/web/primitives/`: `DataTable` (header row, body rows, trailing actions column),
  `Section` (the `<section><header><h2>…` shell), `EmptyState` (the 14 “No X yet.” lines), and
  `DetailList` (the `<dl>` on the three view screens) — deferred here from increment 1 so each
  lands with a real consumer.
- Migrate `TagsSection`, `MentionedInSection`, `MilestonesSection`, `RelationshipsSection`,
  `ContactMethodsSection` to props-in/paths-in.

The **view screens** (`PersonView`, `PetView`, `RelationshipView`) were listed here and move in
increment 4 instead: they also render `GiftsSection` and `HolidaysSection`, which don't move
until then, so a package-side view screen would need a temporary slot API that increment 4 would
delete. They adopt `DetailList` here while staying in the app.

**Done when:** the three view screens render identically; sections have tests for their empty
states and their action-link targets.

### 4 — Write-capable sections

**Goal:** the direct-IPC group. Needs the callback seam, so it follows 3. Split into three
shippable parts, because the gift cluster is far more entangled than the holiday one: it reaches
`GiftCaptureForm` (494 lines, otherwise increment 5) and eight `window.api` methods.

**4a — the write seam + Holidays (done).**
- `src/headless/useSerializedWrites.ts` — the `inFlight` promise chain + `busy` + `error`,
  extracted once. **Keep the rejection-handler semantics**: without it a single rejected write
  leaves the chain rejected and the surface wedges silently.
- `MultiAddCombobox` and `HolidaysSection` move; the section takes `onSetObserves` + `onChanged`.
- `formatOccurrence` was duplicated verbatim on both clients; it moves to `@leapsake/schema`
  beside the other formatters (the repo's convention), not to the UI package.

**4b — the gift cluster (done).** `GiftsSection`, `GiftIdeaRecipientsSection`,
`GiftAdornmentsEditor`, `GiftOccasionFields`, and `GiftCaptureForm` (which increment 5 would
otherwise own — it comes along because `GiftsSection` renders it). Their nine reads and writes
arrive through a **`GiftsPorts`** interface the app implements once, rather than as props: the
components nest three deep across four screens, so prop-drilling would put most of the functions
on components that only forward them. `useRevalidator` stays in the app-side containers, reached
through `onChanged`.

**4c — the three view screens (done).** `PersonScreen`, `PetScreen` and `RelationshipScreen` in
the package; `PersonView`, `PetView` and `RelationshipView` in the app reduced to loader-reading
containers. The screens take a breadcrumb `trail` (which route is home is a client decision) and
a `duplicateCount` rather than core's `DuplicateCandidate[]` — the banner only ever needed the
count.

**Done when:** add/remove round-trips work on Person, Pet, and gift-idea screens, including the
rapid type→Enter→type→Enter case the serialization exists for.

### 5 — Forms

- `src/web/patterns/FormShell.tsx` (header + submit/cancel + `<fieldset disabled>`) and
  `primitives/Field.tsx` (the labeled input/select row).
- Migrate `PersonForm`, `PetForm`, `MilestoneForm`, `GiftIdeaForm`, `ReminderForm`,
  `ContactMethodForm`, `RelationshipForm`, `RelationshipFields`, `WithWhomFields`,
  `ReminderScheduleFields`, `GiftCaptureForm` (largest at 494 lines — consider splitting it
  across two commits).
- Field `name`s must stay byte-identical: `router.tsx`'s actions read them from `FormData`.

**Done when:** every create/edit path saves correctly, and the forms still submit with JS
disabled in the Electron devtools (the no-JS floor rehearsal — cheap here, load-bearing for web).

### 6 — The import overlay

- Move `DropImportProvider` + `ImportOverlay.module.css` to `@leapsake/ui/web` essentially
  unchanged (it is already DOM-only and framework-free).
- Convert `ImportReview` to injected `onPreview`/`onCommit` callbacks; `useNavigate` and
  `useRevalidator` stay in the app container.

**Done when:** dropping a `.vcf` on the desktop app still previews, flags duplicates, and commits.

### 7 — `@leapsake/view-models` (independent; any time)

**Goal:** stop desktop and mobile from maintaining the same derivations twice.

- New package depending only on `@leapsake/schema` (plus `@leapsake/core` *types*) — deliberately
  lighter than `packages/core`, whose `views.ts` keeps the view-models that need repo access.
- Extract, with tests, the logic currently duplicated between
  `apps/desktop/src/renderer/src/**` and `apps/mobile/components/**`:
  - the `IdeaGroup` union-and-sort in `GiftsSection` (byte-identical across clients today),
  - the observed/addable split in `HolidaysSection`,
  - the open/done partition + CTA mapping in `ReminderList`,
  - the given-sinks ordering in `GiftList`.
- Update **both** clients to consume it. Mobile is the proof that the package is genuinely
  headless.
- Do **not** move trivia like `joinBits` — three duplicated lines are cheaper than a shared home.

**Done when:** both clients import the shared derivations, the package has unit tests, and
`pnpm test` passes. Mobile behavior is unchanged (verify on a booted device or by inspection —
these are pure functions).

## Not in scope — stays in `apps/desktop`

- `router.tsx` — every loader and action, and all `FormData` parsing.
- All `window.api` / `window.sync` / `window.boot` access.
- `screens/Settings.tsx` (1,067 lines of sync / key-custody / recovery UI — desktop-shaped;
  revisit only if the web app needs an equivalent).
- `screens/RecoveryGate.tsx`, `main.tsx`'s boot gate.
- `screens/ErrorPage.tsx` (`useRouteError` is router-specific).

## Post-v0.1 doors (deliberately left open, not built)

- **The design system.** `@leapsake/ui/tokens` grows real values and the components grow styles.
  Pre-v0.1 but explicitly *after* this extraction — see *Owner decisions*.
- **React Native components beside DOM ones.** What genuinely shares: **tokens** (plain data,
  already), **headless hooks** (`useTypeahead`, `useSerializedWrites`, `routes` — already), and
  the **props types**, so a `MilestonesSection` on either platform takes the identical contract
  and the implementations can't silently diverge. What can't share: rendered output — a `<table>`
  and a `<FlatList>` have nothing in common but intent. If it happens, add `src/native/` behind
  its own subpath export (Metro's `.native.tsx` platform resolution is the alternative; explicit
  subpaths are less magic and keep DOM code unreachable from Metro's graph).
- **`apps/web` itself.** Framework still open — see *Open questions* in
  [`status.md`](./status.md). The `UiAdapter` contract above is deliberately minimal enough for
  React Router or Next to satisfy.

## Open questions

- **Web framework** (tracked in [`status.md`](./status.md)) — must support SSR/no-JS *and* a
  client-side decryption path. It doesn't block any increment here, but it decides whether the
  `Form` adapter wraps React Router's `<Form>` or a server action.
- **CSS strategy in the package.** CSS Modules work under Vite for a source-only workspace dep;
  Next.js would need `transpilePackages`. Argues for keeping styling minimal until the framework
  lands — which is the plan anyway.
- **Where `@leapsake/view-models` ends and `packages/core`'s `views.ts` begins.** Working rule:
  needs repo/driver access ⇒ `core`; pure derivation over already-loaded data ⇒ `view-models`.
  Revisit if the boundary starts requiring judgment calls on every addition.
