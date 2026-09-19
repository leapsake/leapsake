# Comments explain behaviour, not decisions

**Decision (owner, 2026-09-16):** adopt the rule below going forward, then apply it to the
existing code in one pass. Decisions live in `git log` and in docs (package `README.md`s, not
`plans/`). Source comments exist only where the code is currently hard to understand.

## The rule

**Landed in `AGENTS.md` → _Principles_.** It is in force for every file any workstream touches;
what is left here is the pass over the code that predates it.

Explaining behaviour and explaining decisions are different acts. "Sort each person by
whichever name part they have" is behaviour and earns its two lines. "Retired on 2026-07-27
(migration 27) because layer 3's only consumer went away" is a decision and belongs to the
commit that made it.

## Status

**Steps 1 to 4 (`schema`, `reminders`, `key-custody`, `data`, `core`) are done and lint-enforced.
Step 5 (`apps/desktop/src`) is underway: `main/index.ts` and `router.tsx` are done, `Settings.tsx` is next.**
The `files` list of the comment-rules override in `.oxlintrc.json` is the record of which
directories are finished.

## Why this is worth a pass

The biggest remaining files, measured 2026-09-18:

| File                                  | Total | Comment | Share |
| ------------------------------------- | ----: | ------: | ----: |
| `apps/mobile/lib/core-context.tsx`    | 1,401 |     490 |   35% |

"Comment" counts lines starting with `//`, `*` or `/*`. For scale: `packages/schema` went from
about 2,850 comment lines to about 900, `packages/reminders/src` from 1,522 to 383,
`packages/key-custody/src` from 940 to 213, `packages/data/src` from 2,202 to 615, and
`packages/core/src` from 364 to 164, `apps/desktop/src/main/index.ts` from 318 to 79, and `router.tsx` from 312 to 111.

Decision-history markers in non-test source, by grep, before the pass began:

| Pattern                                                    | Hits |
| ---------------------------------------------------------- | ---: |
| an ISO date                                                |  334 |
| `§` (a section reference into `plans/encryption/model.md`) |  295 |
| `used to`                                                  |   86 |
| `plans/`                                                   |   75 |
| `no longer`                                                |   56 |
| `slice N` (custody slice numbers)                          |   49 |
| `(owner, 20…)`                                             |   44 |
| `migration N`                                              |   28 |
| `retired`                                                  |   18 |

Each of those is a comment that will be wrong the moment the referenced doc, slice, or plan
moves, and the repo's own `plans/README.md` already says finished work leaves `plans/`.

## The procedure

Work step by step (_Steps_ below), and within a step file by file, biggest share first. For
every comment:

1. **Restates the code** (`// increment the counter`, a JSDoc that repeats the signature)
   → delete.
2. **Decision, history, or provenance** (a date, a slice or migration number, "was", "used
   to", "retired", "replaced", "(owner, …)", a `plans/` path, a `§` reference) → delete. If the
   _durable_ part (an invariant that still holds and is not obvious from the code) is not
   already in the package `README.md`, add one sentence there. Do not move the paragraph.
3. **Explains behaviour the code cannot** (a non-obvious ordering, a platform quirk, why a
   guard exists) → keep, cut to two lines. If it cannot be cut to two lines, first try to make
   the code say it (a named function, a named constant, a type); if it still cannot, leave it
   and flag it in the commit message for discussion.
4. **JSDoc on an exported symbol** → keep a one-line summary; `{@link}` cross-references are
   fine; move anything longer under rules 1 to 3.
5. **A comment that names a test** (`proved by X.test.ts`) → delete; the test is the proof and
   its name should carry it.

Package `README.md`s are in scope for the same reasons, but with a lighter hand: they are the
right home for durable "why", and `packages/reminders/README.md`, `packages/key-custody/README.md`
(its _Invariants_ section especially) and `packages/data/README.md` are where much of the deleted
source history already is. Check that it is, and do not duplicate it back.

**Do not touch behaviour.** This pass changes no code except renames and extractions made to
replace a comment. If a comment turns out to be the only thing that explains a real bug,
leave it and open the bug separately.

## The check: two oxlint rules, scoped by step

`AGENTS.md` says anything a program can check is a check. No existing ESLint or oxlint rule caps
how many lines a comment block runs (`max-lines` counts code; `multiline-comment-style` is about
style), so the check is a local oxlint JS plugin, `scripts/lint/comment-rules.mjs`, run by the
existing `pnpm lint`:

- **`leapsake/max-comment-lines`**, max 2 from day one. It counts consecutive own-line `//`
  comments as one block and a `/** */` block by its prose lines. It does not start loose and
  ratchet down: the limit is the rule.
- **`leapsake/no-decision-comments`** flags the markers above that are precise enough to lint:
  an ISO date, `§`, a `plans/` path, `(owner,`, `slice N`. It catches the short decision comments a
  length limit never sees. `used to`, `no longer` and `migration N` stay a reviewer's call, because
  they are just as often behaviour.
- **`@stylistic/max-len`**, comments only, at 80 columns. Not homegrown: oxlint has no line-length
  rule of its own, so it loads `@stylistic/eslint-plugin` through `jsPlugins`. Code width is
  oxfmt's job, which is why the rule's `code` limit is set out of reach.

**The rare long comment is an exception you can see:**
`// oxlint-disable-next-line leapsake/max-comment-lines -- <why>`. Anyone can grep for those, and
a reviewer can question each one.

**The ratchet is scope, not N.** The rules are on only for directories the pass has finished,
through an `overrides` entry in `.oxlintrc.json` whose `files` list grows by one directory per
step. Test files are out of scope. When step 7 lands, the rules move to the top level and the
override goes away.

The check stops long essays from coming back and catches the obvious history markers. It does not
do the pass: most of the cut is judgment on comments that are short and phrase-free.

## Working a step

1. **Read the package's `README.md` first**, so you know which "why" already has a home there.
   Most deleted history needs nothing added, because the README or `git log` already has it.
2. **See what the rules flag** in a directory that is not yet in scope:
   ```sh
   pnpm exec oxlint -c scripts/lint/comment-rules.oxlintrc.json packages/reminders/src
   ```
   The findings are a floor, not the job: _The procedure_ item 2 also covers short comments no
   lint rule sees. The same config carries the width rule, so it also reports lines over 80.
3. **Edit one file (or a few small ones), then, before committing, prove only comments changed:**
   ```sh
   node scripts/lint/comments-only.mjs          # every changed .ts/.tsx/.mjs against HEAD
   pnpm exec oxfmt <the .ts files you touched>
   ```
   `comments-only.mjs` prints each file with TypeScript's printer, comments stripped, and compares
   it to `HEAD`. Anything reported as `CODE CHANGED` is a mistake unless it is a deliberate rename
   or extraction, which the commit message must then name.
4. **Commit per file or small group, straight to `main`.** The message says where the deleted
   history lives (a README section, a commit hash) and ends "Code is unchanged." Durable "why"
   that no README holds goes into the owning package's `README.md` as a sentence or two;
   forward-looking notes go to the matching section of `plans/v0-2.md`.
5. **Finish the step:** add the directory to the comment-rules override's `files` list in
   `.oxlintrc.json`, run the verification in [`README.md`](./README.md) → _Rules that apply to
   every workstream_, update the _Status_ and the table here, and commit.

Lessons from steps 2 to 4:

- **The verification tiers break the vitest run after them.** The `bundle` tier runs an
  electron-vite build, which switches the native SQLite binary to Electron's ABI. Restore the
  Node build before `pnpm exec vitest run`, by extracting the cached tarball
  (`~/.npm/_prebuilds/*better-sqlite3-multiple-ciphers-*-node-v137-*.tar.gz`) inside
  `node_modules/better-sqlite3-multiple-ciphers`, and confirm by constructing a `Database`, not by
  `require()`: the binding loads lazily. Never run `scripts/ensure-sqlite-abi.mjs` in an agent
  shell; see `AGENTS.md` → _The native SQLite ABI_.
- **Split a big file by section, not by file.** Aim for about 300 deleted lines per commit;
  `engine.ts` (1,858 lines) took four commits, `session.ts` three, `migrations.ts` two. Name the
  section's symbols in the commit subject.
- **An invariant moves before its comment goes.** A ⚠️ warning that still holds and has no README
  home goes into the owning package README first, as a bullet under an _Invariants a change here
  must preserve_ section (key-custody has one; `packages/holidays/README.md` is the model). A
  two-line pointer may stay at the code site when the hazard is local to it.
- **Two traps `comments-only.mjs` will catch, so avoid them:** a SQL `--` comment inside a template
  string is code, not a comment, and editing it reports `CODE CHANGED`. And a file-level doc
  comment followed by a blank line belongs to no declaration; when you cut one, either delete it
  or reattach it, and do not leave a floating `/** */` behind.
- **A rationale repeated at many call sites moves once.** Core's "reconcile after every write"
  was said eight ways in `index.ts`. One README section replaced them all, and each site kept only
  what is particular to it (step 4).
- **Lint before every commit, not just at the end of the step.** A rewrap that looks short can
  still run to 81 columns, and `comments-only.mjs` will not catch it.
- **A comment that describes a real bug stays.** Shorten it, flag it in the commit message, and
  tell the owner (`milestones-repo.ts`'s `removeAllForEntity` TODO is the example from step 3).

Conventions the schema step settled:

- **Comments wrap at 80 columns**, the width oxfmt already gives code. `@stylistic/max-len`
  (from `@stylistic/eslint-plugin`, loaded as an oxlint JS plugin) checks it in the same scoped
  override, for own-line comments only, so a two-line limit is two lines of 80.
- **A section banner** (`// ---` / `// Title` / `// ---`) counts as three lines. Make it a single
  `// Title`.
- **Never run `oxfmt` on Markdown.** The repo excludes `*.md` from formatting, and running it
  on a README rewrites unrelated emphasis and tables.
- **README history markers stay.** `(owner, 2026-09-05)` in a package README is the right home
  for a decision; the lint rules apply to source only.
- **A trailing `//` comment on a code line** is not grouped with its neighbours, so a column of
  field comments is fine as long as each stays short.
- **Keep the README's _Where to look_ rows true.** When a row points at a source comment you are
  deleting, move the reasoning into the README and point the row there instead.

## Steps, each a commit series

1. ✅ `packages/schema`. Done 2026-09-18, in scope.
2. ✅ `packages/reminders/src`. Done 2026-09-18, in scope.
3. ✅ `packages/key-custody/src` and `packages/data/src`. Done 2026-09-18, in scope.
4. ✅ `packages/core/src`. Done 2026-09-18, in scope.
5. `apps/desktop/src`, widened from three files so the lint scope is one directory:
   `main/index.ts` ✅, `router.tsx` ✅, then `Settings.tsx` and the rest of the directory.
6. `apps/mobile/lib/core-context.tsx`, `settings.tsx`, then `components/`.
7. Everything else, by directory. `scripts/` last.
