# Comments explain behaviour, not decisions

**Decision (owner, 2026-09-16):** source comments exist only where the code is hard to
understand. Decisions live in `git log` and in package `README.md`s, never in source or
`plans/`. The rule is in `AGENTS.md` → _Principles_ and binds every file any workstream touches.
This doc is the pass that brings the code written before the rule into line with it.

"Sort each person by whichever name part they have" is behaviour and earns its two lines.
"Retired on 2026-07-27 (migration 27) because layer 3's only consumer went away" is a decision,
and belongs to the commit that made it.

## Where the pass stands

The `files` list of the comment-rules override in `.oxlintrc.json` is the only record of which
directories are finished and enforced. Anything not listed there is still to do. Two steps
remain:

**Step 6: `apps/mobile`, about 5,600 comment lines.** One override entry per directory, in this
order:

| Directory | Comment lines | Start with |
| --- | ---: | --- |
| `apps/mobile/lib` | 1,723 | `core-context.tsx` (490 of its 1,401 lines), then `reminder-row.ts`, `styles.ts`, `record-title.ts`, `device-contacts.ts` |
| `apps/mobile/db` + `apps/mobile/keystore` | 230 | `convert-store.ts` (125): see _Mobile specifics_ |
| `apps/mobile/app` | 1,493 | `reminders/[id]/index.tsx`, `(tabs)/index.tsx`, `(tabs)/_layout.tsx`, `(tabs)/search.tsx`, `data.tsx` |
| `apps/mobile/components` | 1,876 | `ContactMethodFields.tsx`, `AppHeader.tsx`, then by size |
| `apps/mobile/plugins`, `index.ts`, `app.config.ts` | 287 | anything |

**Step 7: everything else, by directory, `scripts/` last.** Comment lines by directory, with
lint findings in brackets:

| Directory | Lines | | Directory | Lines |
| --- | ---: | --- | --- | ---: |
| `packages/ui` | 1,276 (300) | | `packages/notifications` | 247 (28) |
| `packages/vcard` | 1,222 (332) | | `packages/contact-links` | 208 (38) |
| `packages/holidays` | 750 (156) | | `packages/store-layout` | 142 (49) |
| `packages/sync` | 715 (227) | | `packages/contact-import` | 134 (26) |
| `apps/server` | 429 (178) | | `apps/website` | 102 (52) |
| `packages/view-models` | 390 (92) | | `packages/gifts` | 80 (17) |
| `packages/export` | 352 (63) | | `packages/bytes` | 64 (18) |
| `packages/crypto` | 322 (123) | | `packages/highlight` | 60 (13) |
| `scripts` | 2,440 (1,579) | | | |

Measured 2026-09-18 over non-test `.ts`/`.tsx`/`.mjs`/`.js`. A comment line is one starting
with `//`, `*` or `/*`. When step 7 lands, the rules move to the top level of `.oxlintrc.json`
and the override goes away.

## The procedure

For every comment:

1. **Restates the code** (`// increment the counter`, a JSDoc that repeats the signature)
   → delete.
2. **Decision, history or provenance** (a date, a slice or migration number, "was", "used to",
   "retired", "replaced", "(owner, …)", a `plans/` path, a `§` reference) → delete. If the
   _durable_ part (an invariant that still holds and is not obvious from the code) is not
   already in the owning package's `README.md`, add a sentence or two there. Do not move the
   paragraph.
3. **Explains behaviour the code cannot** (a non-obvious ordering, a platform quirk, why a
   guard exists) → keep, cut to two lines. If it will not fit, first try to make the code say
   it (a named function, a named constant, a type); if it still cannot, leave it and flag it in
   the commit message.
4. **JSDoc on an exported symbol** → keep a one-line summary; `{@link}` is fine; anything
   longer falls under 1 to 3.
5. **Names a test** (`proved by X.test.ts`) → delete; the test's name should carry it.

**Do not touch behaviour.** The pass changes no code, except renames and extractions made to
replace a comment. A comment that is the only record of a real bug stays: shorten it, flag it
in the commit message, and tell the owner.

## Working a directory

1. **Read the owning `README.md` first**, so you know which "why" already has a home. Most
   deleted history needs nothing added, because the README or `git log` already has it.
2. **See what the rules flag** in a directory not yet in scope:
   ```sh
   pnpm exec oxlint -c scripts/lint/comment-rules.oxlintrc.json apps/mobile/lib
   ```
   The findings are a floor, not the job: rule 2 above also covers short comments that no lint
   rule sees.
3. **Edit a file or a few small ones, then prove only comments changed, and lint:**
   ```sh
   node scripts/lint/comments-only.mjs          # every changed .ts/.tsx/.mjs against HEAD
   pnpm exec oxfmt <the files you touched>
   pnpm exec oxlint -c scripts/lint/comment-rules.oxlintrc.json <the files you touched>
   ```
   `comments-only.mjs` prints each file with TypeScript's printer, comments stripped, and
   compares it to `HEAD`. `CODE CHANGED` is a mistake unless it is a deliberate rename or
   extraction, which the commit message must then name. Lint every time: a rewrap that looks
   short can still run to 81 columns, and `comments-only.mjs` will not catch that.
4. **Commit per file or small group, straight to `main`.** The message says where the deleted
   history lives (a README section, a commit hash) and ends "Code is unchanged." Durable "why"
   goes into the owning `README.md`; forward-looking notes and known bugs go to the matching
   section of `plans/v0-2.md`.
5. **Finish the directory:** add it to the override's `files` list in `.oxlintrc.json`, run the
   verification below, update the tables above, and commit.

**Verification**, in an agent shell:

```sh
pnpm lint
pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle
pnpm exec vitest run
```

The `bundle` tier runs an electron-vite build, which switches the native SQLite binary to
Electron's ABI and breaks the vitest run after it. Restore the Node build first by extracting
the cached tarball (`~/.npm/_prebuilds/*better-sqlite3-multiple-ciphers-*-node-v137-*.tar.gz`)
inside `node_modules/better-sqlite3-multiple-ciphers`. Confirm by constructing a `Database`, not
by `require()`, since the binding loads lazily. Never run `scripts/ensure-sqlite-abi.mjs` in an
agent shell; see `AGENTS.md` → _The native SQLite ABI_.

## The check

A local oxlint JS plugin, `scripts/lint/comment-rules.mjs`, run by `pnpm lint`, on only for the
directories in the override:

- **`leapsake/max-comment-lines`**: at most 2. Consecutive own-line `//` comments count as one
  block; a `/** */` block counts its prose lines.
- **`leapsake/no-decision-comments`**: an ISO date, `§`, a `plans/` path, `(owner,`,
  `slice N`. `used to`, `no longer` and `migration N` stay a reviewer's call, because they are
  just as often behaviour.
- **`@stylistic/max-len`**: comments only, at 80 columns. Code width is oxfmt's job.

Test files (`**/*.test.*`) are exempt. A rare long comment can carry
`// oxlint-disable-next-line leapsake/max-comment-lines -- <why>`, visible to grep and to review.

## Conventions and traps

- **Split a big file by section.** Aim for about 300 deleted lines per commit, and name the
  section's symbols in the commit subject. `core-context.tsx` will take two or three.
- **An invariant moves before its comment goes.** A ⚠️ warning that still holds and has no README
  home goes into the owning README as a bullet under _Invariants a change here must preserve_
  (`packages/key-custody/README.md` and `apps/desktop/README.md` have one;
  `packages/holidays/README.md` is the model). A two-line pointer may stay where the hazard is
  local.
- **A rationale repeated at many call sites moves once**, to one README section; each site keeps
  only what is particular to it.
- **A section banner** (`// ---` / `// Title` / `// ---`) counts as three lines. Make it one
  `// Title`.
- **A trailing `//` on a code line** is not grouped with its neighbours, so a column of short
  field comments is fine.
- **Keep README pointers true.** When a README row points at a source comment you are deleting,
  move the reasoning into the README and point the row there.
- **README history markers stay.** `(owner, 2026-09-05)` in a README is the right home for a
  decision; the lint rules apply to source only.
- **Never run `oxfmt` on Markdown.** It rewrites unrelated emphasis and tables.
- **Two traps `comments-only.mjs` catches:** a SQL `--` comment inside a template string is code,
  so editing it reports `CODE CHANGED`. And a file-level doc comment followed by a blank line
  belongs to no declaration: when you cut one, delete it or reattach it, never leave a floating
  `/** */`.
- **Text replacement by line number is risky.** A `sed '<n>s|…|'` after an edit that shifted the
  lines overwrites the wrong line; `comments-only.mjs` will not notice a comment replaced by
  another comment. Match on the text instead.

## Mobile specifics

- **`apps/mobile/db/convert-store.ts` becomes a pointer.** Its load-bearing list (the cipher
  pragma, `user_version`, table order, the source and destination guards) is already written
  out in `packages/key-custody/README.md` → _Before you change the conversion_. Keep only what
  is mobile-specific, such as expo-sqlite creating the per-account directory when it opens a
  database by name, which is why this file has no `mkdirSync`.
- **`apps/mobile/test/` is out of scope.** Its self-tests are not named `*.test.*`, so do not put
  `apps/mobile/**` in the override; list the directories above one by one.
- **Much of `core-context.tsx` mirrors desktop's boot path.** The reasoning desktop's comments
  held now lives in `apps/desktop/README.md` (_Swapping the store in place_, _Invariants a
  change here must preserve_) and `packages/key-custody/README.md`. Where mobile shares it,
  point there instead of adding a mobile copy; `apps/mobile/README.md` holds only what differs.

## Known stale docs to fix on the way

Found during the desktop step and left alone because rewriting them was out of that step's
scope. Fix them when step 7 reaches `packages/key-custody` and `packages/sync`:

- `packages/key-custody/README.md` → _The two exits from local-only_ and _Where custody lives
  across the repo_ still describe `apps/desktop/src/main/db/adopt-account-flow.ts` and
  `merge-account-flow.ts`, which the relay removal deleted.
- A doc comment in `packages/sync/src/account.ts` points at the same deleted
  `adopt-account-flow.ts`.
- `rekeyStore` in `apps/desktop/src/main/db/convert-store.ts` has no caller outside its tests
  since the merge flow went. Removing it is a code change, so ask the owner rather than doing it
  in this pass.
