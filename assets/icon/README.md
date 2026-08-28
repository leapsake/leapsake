# App icons

Two hand-edited vector sources live here. **Every PNG the apps ship is generated from them**
by `pnpm icons`, and the generated files are committed.

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

> **Changing an icon means re-running `expo prebuild`** for the platform you want to see it
> on. `pnpm ios` / `pnpm android` build the *existing* native project; they do not re-run the
> pipeline that writes into it. The desktop app needs no such step — it reads its PNGs from
> `apps/desktop/resources/` at launch.

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
work is distributed, so the credit exists **twice, on purpose**:

- [`NOTICE`](../../NOTICE) — for the repository.
- [`packages/ui/src/headless/acknowledgements.ts`](../../packages/ui/src/headless/acknowledgements.ts)
  — for the list both clients render under Settings → Acknowledgements.

**Adding third-party work that ships means adding it to both.**
