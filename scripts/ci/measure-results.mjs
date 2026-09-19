// Throwaway (remote-releases.md step 6): reads measure.yml's results through GitHub's
// public API, which serves check-run annotations without a login (job logs need one).
// Deleted with .github/workflows/measure.yml.
//
//   node scripts/ci/measure-results.mjs                  the latest runs, and the rate limit
//   node scripts/ci/measure-results.mjs <run> [job]      each finished job's annotation
//
// Anonymous calls are capped at 60 an hour; one call per job, so poll sparingly.
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

async function listRuns() {
  const { workflow_runs: runs } = await get(
    "/actions/workflows/measure.yml/runs?per_page=5",
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

const [run, prefix] = process.argv.slice(2);
await (run ? showRun(run, prefix) : listRuns());
