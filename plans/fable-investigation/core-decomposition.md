# Make `packages/core` compose instead of implement

**Decision (owner, 2026-09-16):** do it. The direction is already recorded in
`packages/README.md` ("core is where things are composed, not where they are implemented") and
in the repo's own habit of narrow packages with injected ports. The composition root just never
caught up.

## The shape today

`packages/core/src/index.ts` is 2,894 lines. Its parts:

|                                                                Lines (approx.) | What                                                                                                                                                                                                                                                                               | Verdict                                                                                                                                                                    |
| -----------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|                                                                       1 to 130 | imports                                                                                                                                                                                                                                                                            |                                                                                                                                                                            |
|                                                                     131 to 540 | re-exports of types and values from `data`, `schema`, `reminders`, `export`, `key-custody`, plus ~20 interface declarations for reminder targets and gift views                                                                                                                    | Audit. Both clients already depend on `schema` directly (desktop 38 files, mobile 71) and on `data` (2 files each), so most re-exports are a second door to the same room. |
|                                                                     575 to 890 | `createCore` body before `return`: 19 repo constructions, then 30 local helpers (label resolution, entity cascades, relationship helpers, reminder-engine deps, duplicate scoring)                                                                                                 | The helpers are the domain logic that should live in packages.                                                                                                             |
|                                                                   890 to 2,320 | the returned object literal: `people`, `pets`, `tags`, `holidays`, `relationships`, `milestones`, `reminders` (335 lines), `self`, `notificationSettings`, `gifts` (158), `contactMethods`, `kinship`, `search`, `duplicates`, `export`, `import` (232), `deviceContacts`, `views` | The literal should be one line per section: `reminders: createRemindersApi(deps)`.                                                                                         |
| `holidays.ts` (628), `sync.ts` (732), `views.ts` (439), `holiday-seed.ts` (96) |                                                                                                                                                                                                                                                                                    | `holidays.ts` is the model to copy: it is already `createHolidaysApi(deps)`. It just lives in the wrong package.                                                           |

Comment density in `index.ts` is 34%; workstream 3 handles that after this lands.

## Target

`index.ts` at roughly 500 lines: construct the repos, call each `createXApi(deps)`, assemble
the object, export `CoreApi`. Nothing in it should need a test of its own; the integration
suite in `apps/desktop/test/integration` (64 files) already exercises every section through
`CoreApi`, and `apps/desktop/src/shared/api-channels.ts` fails typecheck if a method
disappears. Those two are the safety net; run both after every step.

**Ports over package imports.** A moved section takes the repos it needs as a `deps` object
(exactly the way `createHolidaysApi` and `createKinshipService` do), typed against the repo
interfaces from `@leapsake/data`. Depending on `@leapsake/data` for types is fine and already
the norm (`key-custody`, `sync`). Depending on `@leapsake/core` is not, ever.

## Steps, each a commit

Order chosen so each step is independently revertible and the file shrinks visibly.

1. **Delete `_keySession`.** The parameter, its four-paragraph justification, and the
   `KeySession` import. `createCore(driver)` is the signature. Both clients drop the argument.
   (Photos in v0.2 will re-add whatever they need; a placeholder parameter is not a design.)

2. **Move `holidays.ts` to `packages/holidays`.** It becomes `createHolidaysApi` exported
   from `@leapsake/holidays`, which gains a dependency on `@leapsake/data` for the repo types.
   `holiday-seed.ts` goes with it. `index.ts` keeps one call.

3. **Entity cascades into `packages/data`.** `removeEntityFacts`, `attachedUnpublished`,
   `softDeleteEntityCascade`, `publishIfUnpublished`, `promotes`, `publishBearerIfUnpublished`,
   `softDeleteEntity`, and `people.merge` become an `entity-service.ts` beside
   `kinship-service.ts` and `duplicate-service.ts`, which are already cross-repo services in
   `data`. The `people` and `pets` sections then call it.

4. **Relationship helpers into `packages/data`.** `createFromSubject`, `createWithNewOther`,
   `editFromSubject`, `orientedNeighbors`, `endpointsOf`, `relationshipLabel` join
   `kinship-service.ts` (or a `relationship-service.ts` if kinship is the wrong name for
   creating edges; pick one, do not make both).

5. **Reminders into `packages/reminders`.** The 335-line `reminders` section plus its helpers
   (`systemReminderDeps`, `regenerateSystem`, `listNotifiable`, `withTagsAndMentions`,
   `listInWindow`, `getInWindow`, `planPhrasing`, `undatedOwnPartnerships`,
   `duplicatePairKeys`, `milestoneIsSelf`, `milestoneBearerLabel`, `resolveMentions`) become
   `createRemindersApi(deps)` in `packages/reminders/src/api.ts`. The engine already lives
   there and already takes `ReminderEngineDeps`; this is the layer that builds those deps from
   repos. The `*ReminderTarget` interfaces (lines ~311 to ~460) move with it. `reminders` gains
   a `@leapsake/data` dependency. Its `README.md` (801 lines) gets a short _Code map_ row and
   loses nothing else; workstream 3 will thin it separately.

6. **Gifts into a new `packages/gifts`.** The 158-line `gifts` section, `giftRecipientsForIdea`,
   and the `GiftForRecipient` / `GiftForIdea` / `GiftIdeaOverview` types. Deps: `giftIdeas`,
   `giftRecipients`, `tags`, `people`, `pets`, `kinship`, `dismissals`. The package is small;
   that is fine and matches `gifts-workstream`'s "two tables" scope.

7. **Import into `packages/vcard`** as `createImportApi(deps)` beside `ingest.ts`, taking
   `storedAs`, `findDuplicateCandidates`, and the `AlreadyStored` type with it. `vcard` gains a
   `@leapsake/data` dependency. If that dependency feels wrong for a format package, split a
   `packages/contact-import` instead; do not leave it in core.

8. **Re-export audit.** For each `export … from` in the 131 to 540 block: if both clients can
   import it from its home package (they already depend on `schema` and `data`), delete the
   re-export and fix the imports. Keep only what is genuinely core's: `CoreApi`, `createCore`,
   `runMigrations`, `SqliteDriver`, and the view-model contracts from `views.ts`.

9. **`sync.ts`.** After [`relay-removal.md`](./relay-removal.md), it holds `syncableRepos`
   (stays in core, it is the allowlist core owns), `createAccountSyncEngine`, `getSyncStatus`,
   `rotateRecoveryPhraseForAccount`, and the client-unreferenced relay functions. Move
   everything but `syncableRepos` to `packages/sync` or `packages/key-custody` by what it
   touches, with its two tests.

10. **`views.ts`** stays in core. It needs repos and is the one thing that is legitimately
    "composition of everything for display". Check whether any of it is pure derivation over
    loaded data; if so, that piece belongs in `@leapsake/view-models` instead.

## Verification

- `pnpm exec node scripts/test-all.mjs --only=typecheck` after each step. `api-channels.ts`'s
  exhaustiveness assertion and `with-sync-kick.test.ts`'s surface pin will name anything lost.
- The 64 integration tests, unchanged. **Do not move or rewrite tests in this workstream**; a
  test that still passes against the moved code is the evidence the move was behaviour-free.
  Moving tests next to their packages is a separate, later choice.
- `packages/README.md`'s package list is generated by `ls`; the README of each new or grown
  package says what it owns in one paragraph. No new doc elsewhere.
