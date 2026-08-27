/**
 * What Leapsake is built out of that other people made, and the licences that ask to be
 * told about it.
 *
 * This is a **licence obligation, not a courtesy**. The app icon is OpenMoji artwork under
 * CC BY-SA 4.0, which requires attribution wherever the work is distributed — a shipped
 * binary counts, so a `NOTICE` file in the repo alone would not discharge it. The repo copy
 * lives in `NOTICE`; this is the half that travels with the app.
 *
 * It lives in `headless` because both clients render it and neither should own the list:
 * a credit that only appears on one platform is the failure mode this prevents.
 *
 * ## Why the entries are not in the message catalog
 *
 * Almost everything here is a proper noun or a licence identifier — “OpenMoji”,
 * “CC BY-SA 4.0”, a URL — and none of those translate. Localizing them would mean
 * inviting a translator to change a licence name, which is the one string that must stay
 * byte-exact. The sentences *around* the list are ordinary UI text and stay with the
 * screens that render them.
 *
 * ## Extending this
 *
 * Add an entry when Leapsake ships something whose licence asks to be credited, or when
 * we simply want to say thank you. `use` is the honest one-liner about what it does for
 * us, in the app's own voice — a reader should not need to know what a rasterizer is.
 * Build-time-only tools (oxlint, vitest, the icon pipeline) are deliberately absent: they
 * are not in the binary, so crediting them here would make the list less true, not more
 * generous.
 */
export interface Acknowledgement {
  /** The work, as its authors name it. */
  readonly title: string;
  /** Who to credit. Omitted when the project name is already the author. */
  readonly author?: string;
  /** SPDX-style identifier where one exists, otherwise the licence's common name. */
  readonly license: string;
  /** Where the licence text lives, for a reader who wants the terms themselves. */
  readonly licenseUrl: string;
  /** The project's own home, for a reader who wants the work. */
  readonly url: string;
  /** What it does for Leapsake, in a sentence a non-developer can read. */
  readonly use: string;
}

export const ACKNOWLEDGEMENTS: readonly Acknowledgement[] = [
  {
    title: "OpenMoji",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://openmoji.org",
    use: "Leapsake's frog — the icon on your home screen — is OpenMoji's, used unchanged.",
  },
];
