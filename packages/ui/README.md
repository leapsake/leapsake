# `@leapsake/ui`

Shared UI: **presentational** web components, and the **headless** hooks that hold
each form's state for web and mobile alike. Components take their data as props,
render markup, and get the two things they can't supply themselves — navigation
and form submission — from an adapter the host app injects. Nothing here reads a
router, calls `window.api`, or owns a write.

The point is that `apps/web` (post-launch) is a port rather than a rewrite, and
that desktop's UI becomes testable for the first time. The extraction is
**complete** — every presentational component the Electron renderer had lives
here. Headless derivations the clients share live one package over, in
[`@leapsake/view-models`](../view-models/README.md).

## What stays with the app

By design, not by omission: `router.tsx` (every loader, action and `FormData`
parse), all `window.*` access, `Settings` (sync and key-custody UI), the recovery
gate, the boot gate, and the error page (`useRouteError` is router-specific).
Everything else under `apps/desktop/src/renderer/src/screens/` is a thin
container — read the loader, render a component from here.

## Three subpaths, deliberately

| Import                  | Holds                           | Platform                |
| ----------------------- | ------------------------------- | ----------------------- |
| `@leapsake/ui/tokens`   | Design tokens as plain objects  | Neutral                 |
| `@leapsake/ui/messages` | The text catalog + its provider | Neutral                 |
| `@leapsake/ui/headless` | Form hooks, ports; zero DOM     | Neutral                 |
| `@leapsake/ui/web`      | DOM components                  | Web + Electron renderer |

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
  Link: ({ href, children, ...rest }) => (
    <Link to={href} {...rest}>
      {children}
    </Link>
  ),
  Form: ({ method, action, children }) => (
    <Form method={method} action={action}>
      {children}
    </Form>
  ),
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

`SearchBar` is the one component that navigates imperatively, and takes an
`onNavigate` prop rather than widening the adapter. If a second ever needs to,
promote it into the adapter instead of growing a second prop.

Everything else a component needs — loaded data, `submitting`, write callbacks —
arrives as **props**, because it is per-screen state the container already holds
rather than ambient chrome.

## Forms

Every create/edit form is written once as state and rendered twice, by platform.
Four pieces per form:

1. **A shaping function** beside the entity it builds, usually in `@leapsake/schema`
   (`giftIdeaInputOf`, `personInputOf`, …): a draft of plain strings in, and either
   `{ ok: true, input }` — what `CoreApi` takes, trimmed, blanks as null — or
   `{ ok: false, errors }` out. **Errors are codes, never sentences**, so each client
   words them. Where the rules belong to another package, the function lives there:
   the contact-method draft is in [`@leapsake/contact-links`](../contact-links/README.md),
   because a handle is reduced by its platform's rules.
2. **A hook** in `headless/forms/`, built on `useDraftForm`, returning `fields`, `set`,
   `update`, `errors`, `canSubmit` and `submit`. It holds the draft and calls the shaping
   function on every render. It owns no text, imports neither the DOM nor React Native, and calls
   no `CoreApi`.
3. **A presentational `*Fields`** per platform: values, setters and error codes in,
   markup out.
4. **A thin `*Form`** per platform: calls the hook and hands its result to the fields.
   On web it frames them in `FormShell`; on mobile it declares the header's `HeaderSave`
   and passes `submit()`'s value to the screen, which writes.

Three rules every form keeps:

- **A web form works with no JavaScript.** It posts named fields through the adapter's
  real `<form>`, and the route's action rebuilds the draft from `FormData` and calls the
  same shaping function, since nothing else has checked. Inputs keep `required` and the
  like even with JS on, so the browser refuses first.
- **Save is never disabled for being not ready.** It looks different, and a press shows
  the reason in a native dialog (`showFormProblem`) from the `problem` prop that
  `FormShell` and `HeaderSave` take, worded from the hook's error code.
- **Nothing is disabled while a write is in flight either.** The control says so
  (`aria-disabled` on web, `accessibilityState.busy` on mobile) and ignores the repeat
  press.

The reminder prompt asks **no delivery question at all** _(owner, 2026-10-01)_. One
tick, “Give a gift”, means getting it and posting it; handing it over instead is said
later, on the posting reminder, when the user actually knows. The schedule rules stay
independent, so `ReminderScheduleFields` can still post one item and hand over
another.

Rows staged on mobile's create form (a person's contacts, milestones, relationships)
call the shaping functions directly rather than through hooks, since they live in one
shared value; that form's Save names the first unfinished section.

## Text

**No component contains a user-visible string.** Text comes from one of two
places, and which one depends on the layer:

- **Primitives take text as props.** `DataTable`, `Combobox`, `MultiAddCombobox`,
  `Section`, `ConfirmDelete` — a building block knows nothing about what it is
  listing or which language the app speaks.
- **Sections, screens and feature components read the catalog** via
  `useMessages()`. Making them take text as props would just relocate the
  hardcoded English to the caller: `PersonScreen` composes seven sections, so it
  would forward forty-odd strings.

```tsx
import { MessagesProvider, en } from "@leapsake/ui/messages";

<MessagesProvider messages={en}>{app}</MessagesProvider>;
```

**The rule that matters: a message taking values is a function, not a template
with holes.** The catalog owns the whole sentence; a component only supplies
data.

```ts
// the component
{m.person.duplicates(count)}
// the catalog decides how English says it — and how Polish would
duplicates: (count) => count === 1 ? "Someone else…" : `${count} other people…`,
```

That is what makes a component structurally unable to assemble a sentence out of
fragments, and it means plural rules, word order and list separators are a
catalog concern rather than something to keep catching in review. Concatenating
user-visible text in a component — `` `${name} (hidden)` ``, `" · with " + label`,
`items.join(", ")` — is the specific thing this forbids.

`common` holds only verbs that are the same action wherever they appear. One
English word often needs several translations by context, so a surface that
wants its own wording gets its own key rather than widening `common`.

`useMessages()` throws when no provider is mounted rather than falling back to
English, which would ship untranslated text to a translated app.

A dedicated i18n library will land eventually. Nothing here assumes which one:
components read a plain typed object, so adopting it replaces `messages/en.ts`
and `messages/context.tsx` and touches no component.

Three things this does _not_ cover, all tracked as the wider i18n workstream:
`@leapsake/schema`'s label tables (`genderLabel`, `kindDefs`, the role labels),
which mobile reads directly; the strings still inline in `apps/desktop`
screens that haven't moved into this package yet; and `apps/mobile`'s plurals,
built in render code as `count === 1 ? … : …` (the person screen's duplicates
banner, the People and Tags tabs, import and export results).

## Chip fields

`ChipTextField` (web) and mobile's counterpart share `useChipDraft`, which holds the
draft, which `@mention` or `#tag` the caret is in, and the picker's hits; each
platform keeps only caret placement, keys, focus and markup. Two grammars:

- **`"prose"`**, a reminder's title and body: the value is the _stored_ text, mention
  tokens and all (`@[Violet Bick](person:<uuid>)`), shown as `@Violet Bick`. Only
  `#` runs are tags. On web a hidden input carries the stored text to `FormData`.
- **`"tags"`**, a Tags field: the text is the stored value and every word chips.

The draft is **state**, not re-derived from `value`, because a `#family` still being
typed and a committed one read identically and only the second is a chip. It is
re-seeded when `value` stops matching what the draft serialises to, which is how a
parent resetting the field looks. Chips are atomic: the caret rests at their edges,
and a selection reaching into one widens to take it whole. The web backdrop paints
its runs through `content: attr(data-run)` because the field sits inside its
`<label>`, and real text nodes would join the label's accessible name.

## Import review and the self claim

A vCard can claim to be the user (`contact.isSelf`). `ImportReview` offers “this is
you” only for a card that claims it, **never pre-ticked**, and passes the user's
answer to the importer in place of the claim, so dropping in somebody else's export
can never silently take over the `self_person` pointer. Agreeing on one card
withdraws it from the rest.

## Feature ports

One exception to “everything else is a prop”: a feature whose components nest
several levels deep and appear on several screens gets a **ports interface** the
app implements once, in the shape of `SqliteDriver` / `KeyStore` / `ImportPorts`
elsewhere in the repo.

`GiftsPorts` is the first. Gift components appear on four screens (a person, a
pet, the gift-idea editor, the standalone create screen) and nest three deep, so
threading nine reads and writes through as props would put most of them on
components that only forward them. The app supplies one implementation:

```tsx
<GiftsPortsProvider ports={desktopGiftsPorts}>{app}</GiftsPortsProvider>
```

The bar for adding another is that shape — deep nesting _and_ several entry
points. A section with one write takes a callback prop instead (`HolidaysSection`
takes `onSetObserves`).

A port lives in `headless/`, not beside the components that read it: it is types
plus a React context, and `apps/mobile` reads the same interface from its own
React Native components. `@leapsake/ui/web` re-exports `GiftsPorts` so a web host
sees one import surface.

## Acknowledgements

`headless/acknowledgements.ts` lists what the shipped app is built from that others
made. It is a **licence obligation, not a courtesy**: the app icon is OpenMoji
artwork under CC BY-SA 4.0, which requires attribution wherever the work is
distributed, and a binary counts, so the repo's `NOTICE` alone would not discharge
it. Both clients render the one list, so no credit can appear on one platform only.

The entries stay out of the message catalog: they are proper nouns, licence names
and URLs, and a licence name must stay byte-exact. Each `use` is one sentence a
non-developer can read. Build-time-only tools (oxlint, vitest, the icon pipeline)
are absent, since they are not in the binary.

## React is a peer dependency

Never a direct one: a `dependency` here could install a second physical React, whose
module-level hook dispatcher then throws “Invalid hook call” in the app that bundles it. The
version is the repo's single catalog pin
([`apps/desktop/README.md`](../../apps/desktop/README.md) → _One React, pinned in the
catalog_), so this package's tests render against the same React both apps ship. The
regression guard is `pnpm --filter @leapsake/desktop check:bundle`; run it after touching
this package's deps.

## Styling, and why there isn't any yet

The tokens are a seed lifted from `apps/mobile/lib/styles.ts`, not a design
system, and nothing consumes them yet. Their surfaces are warm like mobile's;
their type sizes are the original ones and name no family, since mobile moved
colour and shape without touching typography.

Markup moved out of the renderer **unstyled**, deliberately: changing structure
and appearance in one pass makes a regression indistinguishable from a redesign.
The visual pass — `tokens/` growing real values, components growing styles — is
its own pre-v0.1 increment.

It also waits on the web framework, because the CSS strategy follows from it: the
CSS Modules used here work as-is under Vite for a source-only workspace
dependency, while Next.js would need `transpilePackages`. The same question
decides whether the `Form` adapter wraps React Router's `<Form>` or a server
action.

## Tests

Component tests run under the root Vitest with `@testing-library/react` and a
`jsdom` environment (declared per-file via a `@vitest-environment jsdom` docblock,
so every other tier stays on `node`). `pnpm test` runs them.

They are the reason the extraction is safe: before this package existed, the
desktop renderer had **no** test coverage of any kind, which is explicitly why
three near-identical combobox implementations were left un-deduplicated.
