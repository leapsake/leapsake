// Reads a workflow's results through GitHub's public API, which serves check-run
// annotations without a login (job logs need one). gate.sh writes the gate's as one.
//
//   node scripts/ci/results.mjs [workflow]               its latest runs, and the rate limit
//   node scripts/ci/results.mjs <run> [job]              each finished job's annotations
//
// The workflow defaults to ci.yml. Anonymous calls are capped at 60 an hour; one per job.
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
