# App icons

Two hand-edited vector sources live here. **Every icon the apps and the website ship is
generated from them** by `pnpm icons`, and the generated files are committed.

- `logo_color.svg` — the frog as it is seen: launcher and dock icons.
- `logo_bw.svg` — the same drawing as line art only, for surfaces that get one colour. Today
  that is the Android notification icon, which Android renders from *alpha alone* and tints,
  so a full-colour icon would arrive as a solid white square.

**Never hand-edit a generated PNG.** `pnpm test:icons` fails on it, by design — it compares
hashes against `generated.json` rather than re-rendering, so it needs no rasterizer and stays
a cheap static tier. Read [`scripts/icons.mjs`](../../scripts/icons.mjs) for why the framing
constants are what they are; the short version is that they were *measured* (an Android
circular mask crops a naive "66 of 108" adaptive icon) rather than chosen.

Regenerating needs `brew install librsvg imagemagick`. Nothing else does.

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
