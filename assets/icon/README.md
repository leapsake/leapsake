# App icons

Two hand-edited vector sources live here. **Every icon the apps and the website ship is
generated from them** by `pnpm icons`, and the generated files are committed.

- `logo_color.svg` — the frog as it is seen: launcher and dock icons.
- `logo_bw.svg` — the same drawing as line art only, for surfaces that get one colour. Today
  that is the Android notification icon, which Android renders from *alpha alone* and tints,
  so a full-colour icon would arrive as a solid white square.

**Never hand-edit a generated PNG.** `pnpm test:icons` fails on it, by design — it compares
hashes against `generated.json` rather than re-rendering, so it needs no rasterizer and stays
a cheap static tier, and a re-render would also fail on harmless byte differences between
librsvg versions. _How the framing is measured_, below, says why the constants are what
they are: they were *measured* (an Android circular mask crops a naive "66 of 108" adaptive
icon) rather than chosen.

Regenerating needs `brew install librsvg imagemagick`. Nothing else does. They are system
tools rather than a dependency because the script runs only when the artwork changes, and
`sharp`, which bundles both, would put a second native binary into every install of a repo
that already fights one (`AGENTS.md` → _The native SQLite ABI_).

⚠️ **`pnpm icons` leaves `generated.json` unformatted, and the pre-commit hook rejects it.**
The manifest is written with `JSON.stringify(…, null, 2)`, which is not oxfmt's JSON style, so
every regeneration is followed by a blocked commit reading *"these staged files are not
formatted"*. The fix the hook itself prescribes:

```sh
pnpm format && git add -u
```

**Never `--no-verify`** — the hook is right, the manifest genuinely is unformatted. The tidier
fix is to run the manifest through oxfmt inside `scripts/icons.mjs`, or to add it to oxfmt's
ignore list; neither is done, so anyone who touches an icon hits this with no hint that it is
expected.

> **Changing an icon means re-running `expo prebuild`** for the platform you want to see it
> on. `pnpm ios` / `pnpm android` build the *existing* native project; they do not re-run the
> pipeline that writes into it. The desktop app needs no such step — it reads its PNGs from
> `apps/desktop/resources/` at launch.

## How the framing is measured

`scripts/icons.mjs` measures each source's **ink**, not its `viewBox`: the viewBox is 72×72
with the frog off-centre inside it, so it renders once transparent and asks ImageMagick for the
bounding box of the drawn pixels. Each source is measured separately, since `logo_bw.svg` has no
fill and its outline's box is very slightly larger. The ink is then placed with a **nested
`<svg>`**, the measured box as its `viewBox`, so `preserveAspectRatio` does the fit and the
centring. A single-colour output is tinted with an `feColorMatrix` filter, since a parent `fill`
cannot beat the artwork's own attributes and would fill `logo_bw.svg`'s open body; the filter
sits on a `<g>` **inside** the nested `<svg>`, because librsvg stops honouring a viewport on an
element that is also filtered.

How much of each canvas the artwork spans:

- **0.72, `icon.png`**: iOS and Android-legacy mask to a rounded square and pad it, so the frog's
  737px box sits well inside iOS's ~229px corner radius.
- **0.49, `adaptive-icon.png`**: only the central 66dp of 108 is guaranteed unmasked, and Pixel
  masks to a circle. "66 of 108" is 0.611, but that describes a circle; this frog is nearly
  square, so at 0.611 its ear tips sit 0.372 from centre and are sliced off. Fitting the
  artwork's corner radius inside the circle's 0.3055 gives 0.49; the manifest records that
  `contentRadius` so the number can be re-derived if the artwork changes.
- **0.85, `notification-icon.png`**: a 24dp box with about 2dp of breathing room, and no mask.
- **0.96, `logo.png` and the favicons**: nothing masks or pads them, so as tight as the ink goes,
  short of 1.0 so its antialiased edge is never clipped by a later resize.

**macOS draws the tile itself** (see _Why macOS gets its own file_), so `icon-macos.png` puts the
frog on a plate from Apple's grid: the body is 824 of 1024 (0.8047), leaving the margin macOS
reserves for badges and shadow, with a corner radius of 0.225 of the body, close enough to iOS's
~0.2237 that the frog sits the same way in both. A plated output measures its fraction against
the plate and keeps its alpha outside it.

**Alpha is asserted, not trusted.** iOS rejects an app icon with an alpha channel at upload, and so
does Play for its store icon; an Android adaptive foreground and the notification icon need one.
librsvg happens to drop the channel when a canvas is fully covered, but that is its behaviour,
not ours, so the script checks each output and a rasterizer change fails `pnpm icons` rather than
a release. The background is `tokens.surface` from `@leapsake/ui`, **duplicated** because the
script runs outside the TypeScript graph; `--check` does not catch drift between the two, and an
app icon changing colour is a user-visible event worth making deliberately.

The outputs worth knowing about:

- **`assets/store/google-play-icon.png`**, the Play listing icon, is uploaded by hand and consumed
  by no build, hence its own directory. Play takes exactly 512×512, opaque, framed like
  `icon.png`.
- **`notification-icon.png`** comes from `logo_bw.svg`, because Android draws a small icon from
  alpha alone; at 96px, the largest density expo-notifications asks for.
- **`logo.png`** is the mark the app draws inside itself: transparent, since a cream tile would
  read as a wrong square on the header, and one 256px density, since it is drawn at ~26pt. The
  desktop's copy is separate, because each client bundles its own assets; the manifest keeps
  the bytes identical.
- **`apps/desktop/resources/icon.png`** is full-bleed: Windows and Linux frame it themselves.

## The website's three

`apps/website/public/` gets `favicon.svg`, `favicon.ico` and `apple-touch-icon.png`, linked
from `src/layouts/Base.astro`. They are generated rather than copied because the source's
viewBox is 72×72 with the frog off-centre inside it — served as-is the frog would sit low and
left in the tab. The framing lives in the script, as it does for every other output.

The two favicons are transparent and cropped tight: a browser hands a favicon a 16px box and
draws it edge to edge, and a cream tile in a dark tab strip would read as a light square.
`apple-touch-icon.png` is the opposite on both counts — iOS masks and pads it exactly like a
home-screen app icon, so it is framed like `icon.png` and carries the cream background, which
is what makes the site's tile and the app's tile look like one product.

The `.ico` frames are reduced from a 256px render rather than rasterized at 16px each: below
about 20px, rendering line art directly drops sub-pixel strokes to nothing, where a reduction
keeps them as grey.

## Why macOS gets its own file

`icon-macos.png` is the same frog as `icon.png` and is not a duplicate. iOS and Android are
handed a full-bleed square and round it off themselves; macOS composites the file exactly as
given, so the rounded tile *and* the ~10% margin macOS reserves for the badge and the drop
shadow have to be drawn into the pixels. A full-bleed square in the Dock is a hard-edged tile
sitting slightly larger than every icon beside it.

It is applied at runtime by `app.dock.setIcon` in the desktop main process, because until
packaging lands there is no app bundle to read an icon *from* — see
[`apps/desktop/README.md`](../../apps/desktop/README.md) → *The app's face on macOS*.

## Attribution

The artwork is OpenMoji's, under CC BY-SA 4.0. That licence wants attribution wherever the
work is distributed, so the credit exists **three times, on purpose** — once per thing that
distributes it:

- [`NOTICE`](../../NOTICE) — for the repository.
- [`packages/ui/src/headless/acknowledgements.ts`](../../packages/ui/src/headless/acknowledgements.ts)
  — for the list both clients render under Settings → Acknowledgements.
- A comment inside the generated `apps/website/public/favicon.svg` — for the website, which
  serves the artwork to people who never install anything. It is written by
  `scripts/icons.mjs`, not by hand.

**Adding third-party work that ships means adding it to all three.** The website's is the
weakest of them: a comment in a file nobody opens is a reasonable manner of attribution for
an icon, but the site has no Acknowledgements page of its own, and it should get one when it
grows anything else third-party.
