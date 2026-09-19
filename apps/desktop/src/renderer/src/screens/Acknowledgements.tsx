import { ACKNOWLEDGEMENTS, type Acknowledgement } from "@leapsake/ui/headless";
import { Link } from "react-router-dom";

/**
 * The in-app half of the attribution in `NOTICE`. The list is shared with
 * mobile; only the framing sentences are this client's own.
 */

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

/** `rel="noreferrer"`: no third party learns which screen the reader left. */
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
