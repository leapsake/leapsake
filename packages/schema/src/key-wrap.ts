import { z } from "zod";

/**
 * What a `key_wrap` row wraps: the master key, the account private key, or a
 * per-item content key. The same envelope table holds all three — they differ
 * only by this discriminator (plans/encryption/model.md §3).
 */
export const wrappedKindSchema = z.enum([
  "master",
  "account_private",
  "content",
]);

export type WrappedKind = z.infer<typeof wrappedKindSchema>;

/**
 * Who can unwrap a `key_wrap` row — exactly the custody ledger's unlock paths
 * and recipients (@leapsake/key-custody). The full set is enumerated
 * now even though Stage 1 only writes `enclave | recovery | password |
 * master`; the rest (`recipient`, `server_principal`, `session`) light up in
 * later stages by simply being written, never altering this schema.
 *
 * A **capability link is not in this list on purpose**: it carries the content
 * key in a URL `#fragment` the server never sees, so it has no row here at all
 * (model.md §11). That absence is what makes it zero-knowledge.
 */
export const principalKindSchema = z.enum([
  "enclave", // device.id — a device's local unlock of MK
  "recovery", // the recovery-key unlock of MK
  "password", // the KEK unlock of MK
  "master", // anything wrapped under MK (account private key; owner's copy of every CK)
  "recipient", // account.id — authenticated share to another user's public key
  "server_principal", // constrained reader (Alexa / CardDAV / hosted link)
  "session", // transient SSR wrap(MK, session key)
]);

export type PrincipalKind = z.infer<typeof principalKindSchema>;

/**
 * A `key_wrap` row — the universal envelope. "Wrap this key for that principal"
 * is a single immutable-once-written event: rows are appended (grant) or
 * soft-deleted (revoke), never mutated. The wrapping algorithm is recorded
 * per-row in `alg` so the primitive can change later without reshaping data.
 *
 * That append/revoke property is load-bearing beyond tidiness: it makes the key
 * tables **conflict-free under any merge model** — merging two devices is
 * union-of-grants minus union-of-revokes, which is order-insensitive. Whatever
 * the domain rows settle on, these tables need nothing from it.
 */
export const keyWrapSchema = z.object({
  id: z.uuid(),
  wrappedKind: wrappedKindSchema,
  contentKeyId: z.uuid().nullable(), // set iff wrappedKind = 'content'
  principalKind: principalKindSchema,
  principalRef: z.string().nullable(), // device.id | account.id | …; null for singletons
  ciphertext: z.instanceof(Uint8Array), // the wrapped key bytes (stored BLOB)
  alg: z.string().min(1), // wrap-algorithm id, e.g. crypto's ALG
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(), // soft-delete = revoke this grant
});

export type KeyWrap = z.infer<typeof keyWrapSchema>;

/** Input accepted when adding a wrapping; the repository fills id/timestamps. */
export const addKeyWrapInputSchema = z.object({
  wrappedKind: wrappedKindSchema,
  contentKeyId: z.uuid().nullable().optional(),
  principalKind: principalKindSchema,
  principalRef: z.string().nullable().optional(),
  ciphertext: z.instanceof(Uint8Array),
  alg: z.string().min(1),
});

export type AddKeyWrapInput = z.infer<typeof addKeyWrapInputSchema>;
