# `@leapsake/website`

`leapsake.com` — marketing, legal, and (later) help docs and a blog. An Astro site
that builds to static files and ships **zero JavaScript**.

## Why it lives in the monorepo

The site must be changeable **without cutting a release**: a typo fix should not
require a version bump, and it must never be able to force one. That sounds like an
argument for a separate repository, and it isn't — the decoupling it needs is at the
**deploy trigger**, not the repository.

Releases are tag-driven and `main`-only (`CONTRIBUTING.md` → _Versioning and
releases_). Cloudflare Pages builds on **push**, filtered to this directory. Those
are different triggers, so a docs fix pushed to `main` deploys in about a minute and
cuts no release.

What being in the monorepo buys, and a separate repo would have cost:

- `PRIVACY.md` is rendered from the repository root, so its "changes in the same
  commit as the code that invalidates it" invariant survives with **no sync step**.
  See `src/content.config.ts`.
- `@leapsake/ui` is a `workspace:*` import, so the site can wear the product's design
  tokens without publishing a package to a registry.
- Feature docs can be authored in the same commit as the feature they describe.

The one deliberate exception is the version: **`apps/website` is outside the version
set** and its `package.json` carries no `version` field. `scripts/set-version.mjs`
excludes it by name, with the reasoning at the exclusion.

## Deployment

Cloudflare Pages, connected to this repository. It builds from a **private** repo,
which is why the site could go live before the repo went public.

| Setting | Value |
| --- | --- |
| Build command | `pnpm --filter @leapsake/website build` |
| Output directory | `apps/website/dist` |
| Root directory | repository root |
| `NODE_VERSION` | `24.16.0` — set explicitly rather than relying on `.tool-versions` |
| Path filter | `apps/website/**`, `PRIVACY.md`, `packages/ui/**` |

DNS is Cloudflare's; the registrar is unchanged. The apex serves the site and `www`
redirects to it.

## Two traps

**Do not add React.** Astro does not need it and `@leapsake/ui/tokens` is plain data
with no imports. `packages/ui/README.md` documents a real "Invalid hook call" failure
caused by a second physical React in a bundle, and its regression guard
(`pnpm --filter @leapsake/desktop check:bundle`) does **not** extend here. When a
component finally earns a React island, add the guard in the same commit.

**`@leapsake/ui` exports raw `.ts` source**, so `astro.config.mjs` lists it under
`vite.ssr.noExternal`. Without that the build dies on an unparsed TypeScript import
the moment anything reads the tokens.

## Styling

One stylesheet, in `src/layouts/Base.astro`, and the custom properties in it are
_derived_ from `@leapsake/ui/tokens` rather than copied — so there is no second place
a colour has to be updated.

It is deliberately plain. The tokens call themselves "a seed, not a design system"
and the app's real visual pass is still ahead; when that happens it happens once, for
app and site together, and this file inherits it by re-reading the same tokens.

## Known gap: `.astro` files are not formatted

`oxfmt` formats JavaScript, TypeScript and JSON, and has no `.astro` parser — so
those files pass `pnpm test:format` without being checked. Adding Prettier and its
Astro plugin would fix it and would be the repo's only formatter-shaped dependency
for a handful of template files, which does not pay for itself yet (`AGENTS.md` →
_Principles_). Keep `.astro` files tidy by hand.

## When the web app arrives

`leapsake.com` is meant to send a signed-in visitor to the app and everyone else to
marketing. That needs an edge function reading a cookie — a Pages Function of about
fifteen lines — and it cannot be done by a purely static host, which is the reason
this one runs on Cloudflare rather than GitHub Pages.

Two decisions belong to the web app's auth design, and both are cheap now and
annoying later:

- **The session cookie must be set on `Domain=.leapsake.com`**, not on
  `app.leapsake.com` alone, or an edge function at the apex can never see it. Note
  that a domain-wide cookie slightly weakens the origin isolation
  `plans/web-client.md` liked about serving the app from a separate origin.
- **`/` stops being trivially edge-cacheable** — it has to `Vary` on cookie. Check
  cookie _presence_ only at the edge; validity is the app's job after the redirect.
