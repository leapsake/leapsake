/** How a version reads on screen. */
const shown = (version: string) => `v${version}`;
const devBuild = (core: string) => `v${core}-dev`;

/** Channels whose build is never promoted, so it can name itself in full. */
const PRERELEASE = /^\d+\.\d+\.\d+-(alpha|beta)\.\d+$/;

/** Alpha and beta show `extra.release` in full; rc and final show the core,
 *  since `final` promotes the rc binary unchanged. */
export function versionLabel(
  release: string | undefined,
  core: string,
): string {
  if (release === undefined || release === "dev") return devBuild(core);
  if (PRERELEASE.test(release)) return shown(release);
  return shown(core);
}
