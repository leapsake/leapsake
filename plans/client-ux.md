# Leapsake — Client / UX odds and ends

> **Unbuilt work only**, and deliberately a grab-bag: these are the cross-client items whose
> own workstreams have finished and been retired. Each is independent of the others. This doc
> is deleted when the list empties.

Sequenced *after* the encryption work in [`encryption/`](./encryption/), but none of them
blocks v0.1.

- **Reminder search** — reminders join `SearchResultType` the way gift ideas did, matched on
  title + body. The last piece of the reminders surface. (Leapsake-defined tasks extend the
  same engine later, keyed off `source` + trigger identity.)
  > Note for whoever builds it: [`onboarding.md`](./onboarding.md) §7 flags that **snoozed**
  > rows need a deliberate answer here — hidden from Home, but findable by search?

- **Styling / the design system** — now that the UI extraction is done,
  [`@leapsake/ui`](../packages/ui/README.md)`/tokens` grows real values and the components grow
  styles. Markup moved out of the renderer deliberately unstyled, so this is the first pass
  where appearance changes at all. Partly gated on the web framework, which also decides CSS
  Modules vs. `transpilePackages`.

- **i18n proper** — the catalog seam is built and no component holds a string. What is missing
  is a library, plus `@leapsake/schema`'s English label tables (`genderLabel`, `kindDefs`, the
  role labels), which mobile reads directly. A cross-client workstream, not a UI-package task.

- **Mobile: the last-device Forget-account confirmation needs a `KeyboardAvoidingView`.** The
  keyboard covers "Delete all data". The screen scrolls, so it is reachable by hand, but it is
  the one step of the custody cycle no automated flow can drive — dismissing the keyboard first
  does not help, because the layout reflows as it goes and the tap lands on whatever moved
  under it. **Fix this screen before trying to make that cycle an E2E flow**
  ([`apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md)).
