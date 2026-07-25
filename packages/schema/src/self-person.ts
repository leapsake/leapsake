import { z } from "zod";

/**
 * The fixed namespace the self-person singleton's primary key is derived under
 * (via `deterministicUuid` in `@leapsake/bytes`, applied in `self-person-repo.ts`
 * — the schema stays a pure leaf, so the derivation itself lives in the data
 * layer, exactly as {@link MENTION_NAMESPACE} / the holiday namespaces do). Kept
 * constant forever — the whole point is that every device mints the **same** id
 * for "you", so the row converges by ordinary whole-row LWW instead of a
 * `people.is_self` flag two devices could set on *different* people (a hard sync
 * failure).
 */
export const SELF_PERSON_NAMESPACE = "leapsake:self-person";

/** The single name the one self-person row is content-addressed under within
 *  {@link SELF_PERSON_NAMESPACE} — there is exactly one, so it is a bare constant
 *  rather than a per-row key (contrast the holiday slug / mention tuple). */
export const SELF_PERSON_ID_NAME = "singleton";

/**
 * The self-person — a synced singleton pointing at the {@link Person} that is
 * "you". It is a *single pointer*, nothing more: your Person is an ordinary
 * Person (no special columns, appears in the people list, has milestones and
 * relationships like anyone else). Gifts are the first feature to need a self
 * concept — who gave / received — and it is also the future kinship ego anchor
 * and the "me" of vCard export.
 *
 * `personId` is **non-polymorphic** — you are always a Person, never a Pet — and
 * carries no FK: like every synced row it rides the people sync channel and is
 * resolved against the people rows at read, never enforced at write.
 *
 * Sync-safe conventions (see AGENTS.md): the constant `SELF_PERSON_ID` primary
 * key (derived in the repo), epoch-ms UTC timestamps, and a nullable `deletedAt`
 * — a soft-deleted self reads as "unset". Deliberately plaintext (no per-item
 * content key): a self pointer is not a share target, and whole-DB-at-rest +
 * master-key-sealed sync already protect it (as they do every other gift row).
 */
export const selfPersonSchema = z.object({
  id: z.uuid(), // always the constant SELF_PERSON_ID, minted by the repo
  personId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type SelfPerson = z.infer<typeof selfPersonSchema>;

/**
 * The input accepted when setting who "you" are: the id of an existing Person.
 * There is no create/update pair like other entities — the repo owns the
 * singleton upsert (insert the fixed-PK row, or re-point an existing one).
 */
export const setSelfInputSchema = z.object({ personId: z.uuid() });

export type SetSelfInput = z.infer<typeof setSelfInputSchema>;
