# Move form state and validation into `@leapsake/ui/headless`

**Decision (owner, 2026-09-16):** do it. Rendering stays per platform (web in
`packages/ui/src/web`, native in `apps/mobile/components`); the state, validation, and
submit-shaping behind each form is written once as a hook in `packages/ui/src/headless`.

## The shape today

`@leapsake/ui` already has the right layers: `headless/` (717 lines, no DOM, no React Native)
and `web/`. `view-models` already took the sorting and partitioning logic out of both clients.
But the forms never followed: each exists twice, and mobile imports only ten symbols from
`headless` in total.

| Form                       | Web (`packages/ui/src/web`) | Mobile (`apps/mobile/components`) | State each owns                                                                                                                                         |
| -------------------------- | --------------------------: | --------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChipTextField              |                         370 |                               358 | Both already share `composer-draft.ts` from `schema`; the remaining twin code is caret and selection plumbing. **This is the proof the pattern works.** |
| GiftCaptureForm            |                         201 |                               193 | 7 / 5 `useState`; both import one headless helper                                                                                                       |
| RelationshipFields         |                         178 |                               304 | 2 / 0 `useState`; mobile is bigger because it inlines the role picker                                                                                   |
| MilestoneForm              |                         232 |                               128 | 9 / 3 `useState`, mobile has 2 `useEffect`                                                                                                              |
| GiftIdeaForm               |                          76 |                               129 | 2 / 6 `useState`                                                                                                                                        |
| ReminderForm               |                          69 |                               133 | 3 / 5 `useState`                                                                                                                                        |
| ContactMethodForm / Fields |                         291 |                               663 | 2 / 0; mobile's includes the per-kind field set                                                                                                         |
| PersonForm / Fields        |                          90 |                               141 | 2 / 0                                                                                                                                                   |

And beside the forms, two row-affordance modules with different exports doing one job:

|                       |                                               Desktop |                                                                Mobile |
| --------------------- | ----------------------------------------------------: | --------------------------------------------------------------------: |
| `lib/reminder-row.ts` | 238 (`ctaLinkFor`, `rowAffordanceFor`, `showsRemove`) | 358 (`offerFor`, `isAnsweredInline`, `showsDelete`, `removalCopyFor`) |

Both already import `ReminderCta` and `ReminderRowAction` from `@leapsake/view-models`, which
is where the shared half of this belongs.

## The pattern

**Decided (owner, 2026-09-26): progressive enhancement, and presentational components apart
from stateful ones.** A web form must work in a client with no JavaScript, even though
Electron and React Native always have it: that is what lets `packages/ui/src/web` serve a
future web client and desktop alike, and lets every platform share the hooks. So a web form
posts named fields to its route through the adapter's real `<form>` (never JSON), and the
route's action validates on its own, because without JS nothing else has checked.

Four pieces per form:

1. **A pure shaping function** in `schema`, next to the entity: a draft of plain strings in,
   `{ ok: true, input, … }` or `{ ok: false, errors }` out, where `input` is what `CoreApi`
   takes and each error is a **code**, never a sentence. Both the hook and desktop's router
   action call it, so trimming, blanks-to-null and validation exist once.
2. **A headless hook** in `packages/ui/src/headless/forms/`, returning `{ fields, errors, set,
   submit, canSubmit }`. It holds the draft (initial state from the entity being edited, or
   the create defaults) and calls the shaping function. It is the enhancement: with JS, Save
   disables until the draft is valid. It owns no user-visible string, imports neither
   `react-native` nor the DOM, and calls no `CoreApi`.
3. **A stateless presentational `*Fields` per platform**: values, setters and error codes in
   as props, markup out. On web every input keeps its `name`, so the post works with no JS.
4. **A thin stateful `*Form` wrapper per platform**: calls the hook and hands its result to
   the fields, with no styling or markup primitives of its own. On web it frames the fields
   in `FormShell`; on mobile it declares the header's Save and gives `submit()`'s value to
   the screen, which calls core.

**Decided (owner, 2026-09-26): Save is never disabled for being not ready.** It looks
different until the draft is valid, and a press before then shows the reason in a native
dialog: `showFormProblem` (web: `window.alert`; mobile: `Alert.alert`), the one place a
Leapsake modal replaces later. The wrapper passes the reason as `FormShell`'s or
`HeaderSave`'s `problem` prop, from a catalog message keyed by the hook's error code. Web
inputs keep `required` (and the like) **with JS on too**, so the browser's own validation
runs first and the alert covers only what HTML cannot express. As each form migrates,
`canSubmit`/`canSave` leave it; when the last one has, delete them. The two gates outside
these forms (`MilestoneForm`'s month-dependent day picker on web, `ImportReview`'s commit)
are a separate commit.

**Nothing is disabled while a write is in flight either** (owner, 2026-09-26). The control
stays focusable, says so (`aria-disabled` on web, `accessibilityState.busy` on mobile), and
its handler ignores the repeat press; a web form does it in `onSubmit`, with
`holdWhileSubmitting` or `FormShell`'s own guard. Inputs that must not change mid-write are
`readOnly`, not `disabled`.

Desktop's router action keeps reading `FormData` (every `FormData` parse stays with the app,
per `packages/ui/README.md`), but only to rebuild the draft it hands the shaping function.

The composer draft is the reference for the pure half: `schema/composer-draft.ts` holds the
model, `ChipTextField` on each platform holds only what the platform's text input needs.

## Steps, each a commit

Smallest and most duplicated first, so the pattern is settled before the big ones.

1. **`useGiftIdeaForm`. ✅ Landed 2026-09-26**, and it is the worked example of the pattern:
   `giftIdeaInputOf` in `schema/gift-idea.ts`, the generic `useDraftForm` beside the hook in
   `headless/forms/`, `GiftIdeaFields`/`GiftIdeaForm` on each platform, and desktop's
   `giftIdeaEditAction`. Checked by hand on both platforms.
2. **`useReminderForm`**, then **`useGiftCaptureForm`** (extend the existing
   `headless/gift-form.ts` rather than adding beside it).
3. **`useMilestoneForm`**. Watch mobile's two `useEffect`s: whatever they synchronise is either
   derived state (make it a computed value in the hook) or a genuine effect (keep it on the
   platform side and say why in one line).
4. **`useRelationshipForm`** with the role-picker options as part of the hook's output, so
   mobile's inlined picker and web's `RelationshipFields` read one list.
5. **`useContactMethodForm`**: the per-kind field set (which kinds take a label, which take a
   handle, which are `https`-only) is data, not UI. Put it in `@leapsake/contact-links` next to
   the kind definitions if it is not already there, and have the hook read it.
6. **`usePersonForm`** and **`usePetForm`**.
7. **Reminder rows**: merge the two `reminder-row.ts` modules into `@leapsake/view-models`
   as one `reminderRowOf(action, cta)` returning a platform-neutral affordance (`offer`,
   `inline`, `showsRemove`, `removalCopy` key). Each client keeps only the mapping from that to
   a link or a sheet. Both existing test files (desktop 283 lines, mobile) fold into one in
   `view-models`.
8. **ChipTextField**: last, and only if steps 1 to 7 leave an obvious shared caret/selection
   hook. It may be that the remaining twin code is genuinely platform text-input handling; if
   so, stop and say so.

## Verification

- `packages/ui` tests (jsdom, already configured) for every hook.
- The desktop integration suite is unaffected; these are renderer-only changes.
- **Every form must be exercised on both platforms after its step**, because this is the one
  workstream where a typecheck cannot prove no regression. Desktop: `drive-desktop-app-headlessly`;
  mobile: the Maestro harness in `apps/mobile/maestro`. Create, edit, and the validation-error
  path for each form.
- The catalog rule holds throughout: if a hook ends up with a user-visible string in it, that
  is the bug, not the string.
