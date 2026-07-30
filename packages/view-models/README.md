# `@leapsake/view-models`

The **headless derivations** every client shows the same way — grouping, partitioning and
ordering over data that has already been loaded. Pure functions: no repo access, no DOM, no
React, no platform. That is what lets the Electron renderer, the Expo app and (later) the web
app share them instead of each keeping its own copy of the same sort.

## Why this exists

Desktop and mobile were maintaining these four derivations twice, byte-for-byte in places: the
gift idea union-and-sort, the observed/addable holiday split, the reminders open/done partition,
and the given-sinks ordering on the Gifts screen. Duplicated _presentation_ is cheap; duplicated
_decisions_ are not — the two clients can silently disagree about which gifts lead the list.

## The boundary against `packages/core`

- **Needs repo or driver access ⇒ `@leapsake/core`** (its `views.ts` keeps those view-models).
- **Pure derivation over already-loaded data ⇒ here.**

Revisit the rule if it starts needing judgment every time; so far it hasn't.

## Shape

Every function is **generic over the caller's row type** and constrains only the fields it
reads (`GiftIdeaRef`, `BearerHolidayFacts`, `ReminderStanding`). Core's row types stay
structurally assignable, each client keeps its own type on the way out, and this package stays
off the data layer — the same posture `@leapsake/ui` takes with core's types.

Dependencies: `@leapsake/schema` and `@leapsake/reminders` (for `onboardingRouteOf`, the
well-known-id lookup behind an onboarding nudge's CTA). Never `core` or `data`.

## What stays with the client

Routes and copy. `reminderCtaOf` returns the _decision_ — an onboarding nudge, the duplicates
nudge, or a gift reminder pointing at its recipient (flipped once done) — and each client maps
that to its own router path and its own user-visible label, because the two routers spell the
same screen differently and the label is translatable text.
