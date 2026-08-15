import { z } from "zod";

/**
 * The `account` row — the identity established when the user creates an account
 * (custody Phase 1, plans/encryption/model.md §7). It holds only *public* or
 * *derivable-but-blind* material: the Argon2id `kdfSalt` (public) and the
 * `authVerifier` the server stores to authenticate login (§9.3 — it reveals
 * nothing about the KEK). The account private key is **not** a column; it lives
 * as a `key_wrap` row, keeping the envelope uniform.
 *
 * `publicKey` is nullable and stays NULL through the Stage-1 sync core — the
 * account keypair serves sharing *to other people* and lands in Stage 3
 * (status.md). `kdfAlg` records which derivation this account was created under,
 * so the primitive can change later without locking out existing accounts (the
 * same per-record-`alg` posture as `key_wrap`).
 *
 * `username`/`relayUrl` are the multi-device login coordinates (custody Phase
 * 1/2, plans/encryption/model.md §7.5): the unique handle a second device looks the
 * account up by, and the relay it lives on. Both are NULL for a local-only
 * store (sync never enabled) — they are populated at enable-sync, and on a
 * joining device after login.
 *
 * Same sync-safe conventions as every table (see AGENTS.md): UUID PK,
 * epoch-ms UTC timestamps, nullable `deletedAt` soft delete.
 */
export const accountSchema = z.object({
  id: z.uuid(),
  publicKey: z.instanceof(Uint8Array).nullable(), // account public key, published in Stage 3; NULL until then
  kdfSalt: z.instanceof(Uint8Array), // Argon2id salt (public)
  authVerifier: z.instanceof(Uint8Array), // §9.3 — authenticates login; blind to the KEK
  kdfAlg: z.string().min(1), // derivation id, e.g. crypto's KDF_ALG
  username: z.string().nullable(), // unique login handle; NULL until sync is enabled
  relayUrl: z.string().nullable(), // the relay this account syncs through; NULL until sync is enabled
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Account = z.infer<typeof accountSchema>;

/**
 * Input accepted when creating the account; the repository fills timestamps and,
 * by default, the id. `id` is accepted explicitly so a **joining** device can
 * persist the account id it looked up by username — that id is the relay's
 * per-account namespace and must match across devices.
 * `username`/`relayUrl` default to NULL for an enable-sync that omits them.
 */
export const createAccountInputSchema = z.object({
  id: z.uuid().optional(),
  kdfSalt: z.instanceof(Uint8Array),
  authVerifier: z.instanceof(Uint8Array),
  kdfAlg: z.string().min(1),
  username: z.string().nullable().optional(),
  relayUrl: z.string().nullable().optional(),
  publicKey: z.instanceof(Uint8Array).nullable().optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

/**
 * The `device` row — one registration per device on an account (custody Phase
 * 2). Each device's enclave wrapping of the master key
 * is a `key_wrap` row keyed by this `id` (`principalKind = 'enclave'`); revoking
 * a device is a soft-delete here plus a revoke of that wrap. `publicKey` (the
 * device keypair for QR/device-linking, §13) is nullable and unused in the
 * Stage-1 core.
 */
export const deviceSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  label: z.string().nullable(), // "Josh's iPhone"
  platform: z.string().nullable(), // 'desktop' | 'mobile' | ...
  publicKey: z.instanceof(Uint8Array).nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC — doubles as last-seen
  deletedAt: z.number().int().nullable(), // soft-delete = revoke the device
});

export type Device = z.infer<typeof deviceSchema>;

/** Input accepted when registering a device; the repository fills id/timestamps. */
export const registerDeviceInputSchema = z.object({
  id: z.uuid(), // the stable device id minted in custody Phase 0
  accountId: z.uuid(),
  label: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  publicKey: z.instanceof(Uint8Array).nullable().optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceInputSchema>;
