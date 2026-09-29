// A workflow's latest runs, or `<run> [job]`'s annotations, over GitHub's
// anonymous API. See `.github/workflows/README.md`.
const API = "https://api.github.com/repos/leapsake/leapsake";

async function get(path) {
  const response = await fetch(
    path.startsWith("http") ? path : `${API}${path}`,
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${body.message ?? "no message"}`);
  return body;
}

const NOISE =
  /does not capture|already declared|Node\.js 20|ubuntu-latest label/;

async function listRuns(workflow = "ci.yml") {
  const { workflow_runs: runs } = await get(
    `/actions/workflows/${workflow}/runs?per_page=5`,
  );
  for (const run of runs) {
    console.log(
      `${run.id}  ${run.status.padEnd(11)} ${(run.conclusion ?? "").padEnd(10)} ` +
        `${run.head_sha.slice(0, 7)}  ${run.event}  ${run.created_at}`,
    );
  }
  const { resources } = await get("https://api.github.com/rate_limit");
  const reset = new Date(resources.core.reset * 1000)
    .toISOString()
    .slice(11, 16);
  console.log(
    `\n${resources.core.remaining} API calls left this hour (resets ${reset} UTC)`,
  );
}

async function showRun(run, prefix = "") {
  const { jobs } = await get(`/actions/runs/${run}/jobs`);
  for (const job of jobs.filter((each) => each.name.startsWith(prefix))) {
    const step = job.steps?.find((each) => each.status === "in_progress");
    console.log(
      `\n== ${job.name}: ${job.status} ${job.conclusion ?? ""}` +
        (step
          ? ` (in "${step.name}" since ${step.started_at.slice(11, 16)} UTC)`
          : ""),
    );
    if (job.status !== "completed") continue;
    const notes = await get(`${job.check_run_url}/annotations`);
    for (const note of notes.filter((each) => !NOISE.test(each.message))) {
      if (
        note.annotation_level === "warning" &&
        /^(eslint|unicorn)/.test(note.title ?? "")
      ) {
        continue;
      }
      console.log(
        `[${note.annotation_level}] ${note.title ?? ""}\n${note.message}\n`,
      );
    }
  }
}

const [first, prefix] = process.argv.slice(2);
await (/^\d+$/.test(first ?? "") ? showRun(first, prefix) : listRuns(first));
