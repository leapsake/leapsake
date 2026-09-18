import { z } from "zod";

/**
 * The user's account. It holds only public or KEK-blind material; the private
 * key lives in a `key_wrap` row.
 */
export const accountSchema = z.object({
  id: z.uuid(),
  publicKey: z.instanceof(Uint8Array).nullable(), // unused until sharing exists
  kdfSalt: z.instanceof(Uint8Array), // Argon2id salt (public)
  authVerifier: z.instanceof(Uint8Array), // login check; blind to the KEK
  kdfAlg: z.string().min(1), // the derivation this account was created under
  username: z.string().nullable(), // login handle; NULL until sync is enabled
  relayUrl: z.string().nullable(), // its relay; NULL until sync is enabled
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Account = z.infer<typeof accountSchema>;

/**
 * Input accepted when creating the account. A joining device passes the `id`
 * it looked up, since the relay namespaces by it.
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
 * One device on an account. Its enclave wrap of the master key is a `key_wrap`
 * row keyed by this id; revoking a device revokes both.
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

/** Input accepted when registering a device; the repo fills timestamps. */
export const registerDeviceInputSchema = z.object({
  id: z.uuid(), // the device's stable id
  accountId: z.uuid(),
  label: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  publicKey: z.instanceof(Uint8Array).nullable().optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceInputSchema>;
