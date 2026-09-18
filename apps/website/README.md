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

Root directory is the **repository root**, not this folder: the site depends on
`@leapsake/ui` through `workspace:*`, and an install scoped to `apps/website` cannot
resolve it.

**Two zone features must stay off, and nothing but this sentence records it:** _Email Address
Obfuscation_ (on by default for a new zone; it rewrites the privacy policy's contact address and
injects a decoder script, so a reader without JavaScript sees no address) and _Web Analytics /
RUM_ (injects a `static.cloudflareinsights.com` beacon that browsers report as a tracker). Both
are edge rewrites the build tests cannot see; the byte-for-byte live check that would catch the
next one is `plans/v0-2.md` → _The website's edge is untested_.

**Every push to `main` builds — deliberately no path filter.** Scoping the build to
`apps/website/**` looks obviously right and is wrong here: a `slug` publishes a
markdown file from *anywhere* in the repository, so a doc added beside the feature it
describes would never trigger a deploy. The build takes about a second, which is far
cheaper than that failure would be to find.

The root `pnpm install` runs Electron's postinstall and downloads a binary the site
has no use for. If trimming it is worth the extra moving part, the build command can
do its own scoped install instead:

```
pnpm install --ignore-scripts --filter @leapsake/website... && pnpm --filter @leapsake/website build
```

DNS is Cloudflare's; the registrar is unchanged. The apex serves the site and `www`
redirects to it with a 301 redirect rule — `www` is deliberately *not* a second custom
domain on the Pages project, which would serve the same pages at two URLs and
contradict the canonical tag.

⚠️ **The domain also carries live email** — `hello@leapsake.com`, the address the
privacy policy prints. Its MX, SPF, DKIM and DMARC records share the Cloudflare zone
with the site's, so a DNS change made for the website is a change to mail delivery
too. Two things follow: moving or re-creating the zone must carry those records
across, and the DKIM CNAMEs must stay **DNS-only** — proxying them breaks signing, and
the symptom is mail quietly landing in spam rather than anything that looks like an
error.

## Documentation

**A `slug` in a markdown file's frontmatter is what publishes it**, from anywhere in
the repository:

```yaml
---
slug: contacts/importing
title: Importing contacts
since: "0.4"
---
```

Nothing about a file's location makes it a doc, so a guide can sit beside the code it
describes — the arrangement the rest of the repo already uses for its stable "why".
A markdown file with no `slug` is technical documentation and is passed over. There is
no second flag to forget, because the slug *is* the URL: a doc without one has nowhere
to be published to.

The slug is explicit rather than derived from the filename so that a doc keeps its
public URL when its package is renamed or split — which `packages/README.md` says will
happen. The section is a **content** taxonomy from the closed set in
`src/content.config.ts`, never a package name; being closed is also the reserved-word
check, since a slug then cannot begin `next` or `v0.4` and shadow a version segment.

What this gives up is seeing the published set from a file tree.
`docs-manifest.json` buys it back and more: it maps every public URL to the file that
claims it, it is committed, and `pnpm test:docs` fails when it is stale — so a changed
URL appears in a pull request diff rather than only in a deploy.

### Versioned URLs

| Path | Serves |
| --- | --- |
| `/docs/v0.4/contacts/importing` | a released snapshot — permanent, and **what the app links to**, using its own version |
| `/docs/contacts/importing` | alias to the newest version, for humans and search |
| `/docs/next/contacts/importing` | the unreleased working copy, `noindex` |

The app linking versioned while humans get the alias is what makes version-specific
docs work: someone still on 0.3 reaches 0.3's pages from inside the app, while a
search result lands on current.

**Only `/docs/next/*` is built today.** The snapshots arrive with the release step
that creates them: `pnpm release` copies the living docs into
`src/content/docs/v0.4/`, and from then on that copy is editable in place. Copying is
the point — rendering a snapshot from a git tag would avoid the duplication but would
put a typo fix behind moving a tag, which is exactly the coupling this site exists
without.

The drift rule, so "which one is canonical?" is never a live question: **the in-tree
copy is the unreleased version; `vX.Y/` are released ones.** They are never canonical
for the same thing.

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

## Icons

`public/favicon.svg`, `public/favicon.ico` and `public/apple-touch-icon.png` are
**generated and committed** by `pnpm icons` from the app icon's vector source, and
linked from `src/layouts/Base.astro`. Do not hand-edit them — `pnpm test:icons`
fails on it, and the reasoning behind the framing is in
[`assets/icon/README.md`](../../assets/icon/README.md).

Committed rather than generated at build time for the reason every other icon here
is: regenerating needs librsvg and ImageMagick, and the Cloudflare Pages builder has
neither. `test/site.test.ts` (run by `pnpm test:integration`) proves the three files
reach `dist/` and that the layout links them, which is the half the hash check cannot
see.

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
  the web spike liked about serving the app from a separate origin (`plans/v0-2.md` →
  _Post-launch_ item 1).
- **`/` stops being trivially edge-cacheable** — it has to `Vary` on cookie. Check
  cookie _presence_ only at the edge; validity is the app's job after the redirect.
