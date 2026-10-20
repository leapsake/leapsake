# UX and the design system — what is unbuilt

- **Styling / the design system.** Now that the UI extraction is done,
  [`@leapsake/ui`](../packages/ui/README.md)`/tokens` grows real values and the components grow
  styles. Markup moved out of the renderer deliberately unstyled, so this is the first pass where
  appearance changes at all. **Partly gated on the web framework**, which also decides CSS Modules
  vs. `transpilePackages`; see [`web-and-sharing.md`](./web-and-sharing.md) → _Open_.
- **i18n proper.** The catalog seam is built and no component holds a string. What is missing is a
  library, plus `@leapsake/schema`'s English label tables (`genderLabel`, `kindDefs`, the role
  labels), which mobile reads directly. A cross-client workstream, not a UI-package task.
- **Settings decomposition + an Account screen.** Today both onboarding nudges land a first-week
  user at the top of a ~50KB settings screen and hope they scroll. Split Settings into linked
  sub-screens; give the account flows their own route; extract the account forms so the **same**
  components serve both the Account screen and Settings.
  > Carry the account invitation's deferred guard into this work: the create screen should open by
  > asking _"Do you already have a Leapsake account on another device?"_ — it catches every route
  > in, including Settings visited directly, and is the only guard that does not depend on the
  > user reading two Home rows correctly. Weighed and cut from the invitation itself once the
  > merge made the wrong turn recoverable; see
  > [`../packages/reminders/README.md`](../packages/reminders/README.md).
- **iPad layouts are phone-shaped** _(owner, 2026-09-13: the app supports iPad)_. `supportsTablet`
  has always been `true`, so the App Store listing is universal and reviewers test on an iPad —
  but every screen was designed at phone width, so a 13" iPad gets phone layouts stretched across
  it. That is _acceptable_, not _good_: nothing is unreachable or broken, and the alternative
  (dropping to iPhone-only) is a one-way door, since removing a supported device family from a
  shipped app strands the people who installed it there. What is deferred is the design work —
  multi-column lists, a split view on the person screen, and a look at the four pickers, which
  are the components most likely to look wrong at width.
  > ⚠️ **Nothing automated has ever run on an iPad.** `scripts/lib/mobile-harness.mjs` → `boot`
  > matches `iPhone` specifically, because the flows are phone-shaped. An iPad tier is additive
  > (the same catalog, a different device), but it is not free: every `tapOn` point-percentage in
  > the flows was measured at phone aspect.
- **A desktop import picker.** The `import` nudge lands on the people list because desktop imports
  only by drag-and-drop; the intended fix is a file picker behind that link, not longer copy
  _(owner, 2026-09-13)_.
