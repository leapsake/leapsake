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

One hook per form in `packages/ui/src/headless/forms/`, returning `{ fields, errors, set,
submit, canSubmit }` over plain values. It owns:

- initial state from the entity being edited (or the create defaults),
- every `useState` the two components currently split,
- validation, using the `schema` Zod inputs so the form and the repo agree,
- the shape handed to `CoreApi` on submit.

It must not own: any string a user reads (the catalog in `@leapsake/ui/messages` does),
anything that imports `react-native` or the DOM, or any `CoreApi` call. Submit returns the
input; the platform component calls core. That keeps the hook testable with
`@testing-library/react`'s `renderHook` in the existing `ui` test setup, once, with no
platform.

The composer draft is the reference: `schema/composer-draft.ts` holds the pure model,
`ChipTextField` on each platform holds only what the platform's text input needs. Follow that
split for the rest: if a piece of form logic can be a pure function over a draft, put it in
`schema` or `view-models`; if it needs React state, it is a headless hook.

## Steps, each a commit

Smallest and most duplicated first, so the pattern is settled before the big ones.

1. **`useGiftIdeaForm`**: the smallest pair with the biggest state gap (2 vs 6). Both
   components rewritten to consume it. Add the hook's test.
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
