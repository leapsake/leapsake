# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

Nothing — **09 (mobile global navigation) is done, 2026-08-17.** Four tabs (Home, Search, **New**,
Settings/Account); People demoted from a tab to a catalog reached from Search's browse tiles;
Search opens pre-filtered via `?type=`; one app-drawn header on both platforms whose title shrinks
rather than hides; warm surfaces. The durable *why* sits in `apps/mobile/app/(tabs)/_layout.tsx`
and `components/AppHeader.tsx`; the shell's gate is `apps/mobile/maestro/global-nav.yaml`.
Typography and icons were deliberately left alone — that pass is
[`v0-2.md`](./v0-2.md) → *styling / the design system*.

**Green on both platforms.** `global-nav.yaml` passes on the iOS simulator and the Android
emulator from the same byte-identical file, and is **proven non-vacuous by sabotage** — deleting
the New tab's `preventDefault` turns it red.

⚠️ **Three mobile gates are red or blocked, all of them predating this work. 04 and 06 inherit
them:**

- **Android's `applicationId` is `net.leapsake.mobile`**, but `app.json` (and `v0-1.md`'s
  permanent-bundle-id decision) say `com.leapsake.app`. The committed `android/` project predates
  that decision, so **no Maestro flow can target Android** — every one declares
  `appId: com.leapsake.app`. The Android leg above was run against the real id from a scratch
  copy. Bundle ids are permanent after first publish, so fix this *before* 04 uploads anything.
- `driver-selftest.yaml` — **FAIL 40/42** on the iOS simulator; identical count on `main`.
- `staged-gift-occasions.yaml` — dies in `stage-christmas` on `tapOn: below: "Add a holiday"`,
  same step on `main`. The dev client's floating menu button covers that region and the tap opens
  the dev menu instead; whether that is the whole story is unconfirmed.
