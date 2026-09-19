// What stands between a local machine and a store upload or a tag: `--here`, a tag the
// remote can already see, and the tag typed back. On a runner (`CI=true`) none apply.
import { createInterface } from "node:readline";

export const isCI = (env = process.env) => env.CI === "true";

/** Where a receipt says the release ran: the remote pipeline, or a local machine. */
export const via = (env = process.env) => (isCI(env) ? "remote" : "local");

/** Ask for `tag` to be typed back; true only for an exact match. */
export function confirmTag(
  tag,
  { input = process.stdin, output = process.stderr } = {},
) {
  output.write(`\nType ${tag} to go ahead, anything else to stop: `);
  const lines = createInterface({ input, terminal: false });
  return new Promise((resolve) => {
    let answered = false;
    lines.once("line", (line) => {
      answered = true;
      lines.close();
      resolve(line.trim() === tag);
    });
    lines.once("close", () => {
      if (!answered) resolve(false);
    });
  });
}

/** The reason this machine may not upload `tag`, or `undefined` when it may. */
export async function localUploadRefusal({
  tag,
  here,
  ci,
  remoteHasTag,
  confirm,
}) {
  if (ci) return undefined;
  if (!here) {
    return `refusing to upload ${tag} from this machine without --here — the everyday path is pushing the tag and letting the pipeline ship it`;
  }
  if (!remoteHasTag(tag)) {
    return `origin does not have ${tag} — push the tag first; nothing ships that the remote cannot see`;
  }
  if (!(await confirm(tag)))
    return "the tag was not typed back, so nothing was done";
  return undefined;
}
