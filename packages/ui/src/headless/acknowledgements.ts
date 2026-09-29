/** One credit the shipped app carries; see the README's _Acknowledgements_. */
export interface Acknowledgement {
  /** The work, as its authors name it. */
  readonly title: string;
  /** Who to credit. Omitted when the project name is already the author. */
  readonly author?: string;
  /** SPDX-style identifier where one exists, else the licence's common name. */
  readonly license: string;
  /** Where the licence text lives. */
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
