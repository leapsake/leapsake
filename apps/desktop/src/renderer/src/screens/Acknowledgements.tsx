import { ACKNOWLEDGEMENTS, type Acknowledgement } from "@leapsake/ui/headless";
import { Link } from "react-router-dom";

/**
 * Acknowledgements — the work other people made that Leapsake ships.
 *
 * A licence obligation before it is a courtesy: the app icon is OpenMoji artwork under
 * CC BY-SA 4.0, which asks for attribution wherever the work is distributed, and a shipped
 * app is distribution. The repo's own copy is `NOTICE`; this is the half a user can reach.
 *
 * The list is `ACKNOWLEDGEMENTS` in `@leapsake/ui/headless`, shared with `apps/mobile` so
 * both clients credit the same things — a credit that appeared on only one platform would
 * be the bug. Only the framing sentences below belong to this screen, which is why they
 * are duplicated in the mobile screen rather than shared: they are this client's wording,
 * the way `passwordHint` is.
 *
 * Reached from Settings rather than from the top nav: it is about the app, not a place
 * anyone needs to get to twice. It reads no data and needs no account.
 */

/** Kept at the top of the module rather than inline — see AGENTS.md → User-visible text. */
const TEXT = {
  title: "Acknowledgements",
  intro:
    "Leapsake is built on work that other people made and chose to share. Thank you.",
  back: "← Back to Settings",
  licensedUnder: (license: string) => `Licensed under ${license}`,
  openLicense: "Read the licence",
  openProject: "Visit the project",
} as const;

export function Acknowledgements() {
  return (
    <main>
      <p>
        <Link to="/settings">{TEXT.back}</Link>
      </p>
      <h1>{TEXT.title}</h1>
      <p>{TEXT.intro}</p>
      {ACKNOWLEDGEMENTS.map((entry) => (
        <Credit key={entry.title} entry={entry} />
      ))}
    </main>
  );
}

/**
 * One credit: what it is, what it does for us, and the two links that matter — the licence
 * (the obligation) and the project (the thanks).
 *
 * `rel="noreferrer"` on both, because these open outside the app and there is no reason to
 * tell a third party which screen the reader came from.
 */
function Credit({ entry }: { entry: Acknowledgement }) {
  return (
    <section>
      <h2>{entry.title}</h2>
      <p>{entry.use}</p>
      <p>{TEXT.licensedUnder(entry.license)}</p>
      <p>
        <a href={entry.licenseUrl} target="_blank" rel="noreferrer">
          {TEXT.openLicense}
        </a>{" "}
        <a href={entry.url} target="_blank" rel="noreferrer">
          {TEXT.openProject}
        </a>
      </p>
    </section>
  );
}
