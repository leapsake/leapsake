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

**Not yet run on a device.** `global-nav.yaml` and `staged-gift-occasions.yaml` both need a green
run on iOS *and* Android before 04 cuts screenshots.

## Next

**04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order. 06 also waits on its
*Open decisions*.
