# Workflows

| File          | Runs on                          | Does                                                                        |
| ------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `ci.yml`      | every push and pull request      | `pnpm test`; on a push to `main`, each platform's gate (`scripts/ci/gate.sh`) |
| `release.yml` | a pushed `v*` tag, or `cut.yml`  | plan → gates and builds → publish → record; abandon if nothing was published |
| `cut.yml`     | the button, and hourly           | `pnpm release cut <channel> --push`, then `release.yml` on the new tag      |

Two repository variables switch the release half on: `REMOTE_RELEASES=true` lets
`release.yml` do anything, and `AUTO_FINAL=true` lets `cut.yml`'s schedule run
`cut final --if-approved`. The secrets they read are listed in `.env.example` → _On a runner_.

A failed gate's annotation names the red flow, and `node scripts/ci/results.mjs <run>` reads
annotations through the public API, so a run can be diagnosed without a login.

## Keeping the workflows portable

The host today is GitHub; the next could be GitLab, Forgejo, or anything with a runner.

- **Every step is one command from the repo.** No shell logic, and no marketplace actions
  beyond checkout, Node setup, artifact upload/download and a cache.
- **The scripts decide which jobs exist.** `pnpm release plan --outputs` writes the gate, build
  and publish matrices; adding a platform never touches YAML.
- **Receipts are git notes** (`refs/notes/releases`), not a host's Release page.
- **The trigger is a tag push**, which every host fires on. `cut.yml` is the host-specific sugar.
- **Secrets reach the scripts as environment variables and files**, via
  `pnpm release materialize`. No OIDC, no host attestation.
- **The scripts never read `GITHUB_*`** (bar the `GITHUB_SHA` fallback in
  `apps/mobile/app.config.ts`); the workflow passes the tag. Prompts are skipped on `CI=true`.
- **Pushes are limited to a tag, `refs/notes/releases`, and deleting a tag.** Nothing writes to
  `main`.

What a host move would rewrite, since it is GitHub's expression language rather than a command:
the host-to-runner map (`matrix.host == 'macos'`), the empty-matrix guards, the `!failure()` /
`always()` conditions on `publish`, `record` and `abandon`, the reusable-workflow call from
`cut.yml` (a `GITHUB_TOKEN` push starts no workflow), and the two variable switches.

**The one accepted lock-in is GitHub's hosted macOS runner**, free for a public repo, which
the iOS gate, build and publish need. It is the thing to replace first on a move.
