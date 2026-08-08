import {
  type Account,
  type CreateAccountInput,
  type Device,
  type RegisterDeviceInput,
  accountSchema,
  createAccountInputSchema,
  deviceSchema,
  registerDeviceInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** The `account` table row, exactly as stored (snake_case columns). */
interface AccountRow {
  id: string;
  public_key: Uint8Array | null;
  kdf_salt: Uint8Array;
  auth_verifier: Uint8Array;
  kdf_alg: string;
  username: string | null;
  relay_url: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/**
 * node:sqlite hands BLOBs back as a Buffer; normalize to a plain Uint8Array so
 * callers (and the crypto primitives) get an exact type. Null stays null.
 */
function bytes(value: Uint8Array | null): Uint8Array | null {
  return value === null ? null : Uint8Array.from(value);
}

function toAccount(row: AccountRow): Account {
  return accountSchema.parse({
    id: row.id,
    publicKey: bytes(row.public_key),
    kdfSalt: Uint8Array.from(row.kdf_salt),
    authVerifier: Uint8Array.from(row.auth_verifier),
    kdfAlg: row.kdf_alg,
    username: row.username,
    relayUrl: row.relay_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface AccountRepo {
  /** Create the account row (custody Phase 1); fails the singleton if one exists. */
  create(input: CreateAccountInput): Promise<Account>;
  /**
   * Rotate this device's relay credential after a remote password change: replace
   * the public salt + auth verifier on the singleton account row (and bump its
   * clock). Used by the re-auth flow when another device reset the password — the
   * master key is untouched (it lives in the enclave); only the password-derived
   * door is refreshed. A no-op if no account is set up.
   */
  updateCredentials(input: {
    kdfSalt: Uint8Array;
    authVerifier: Uint8Array;
  }): Promise<void>;
  /**
   * Record the relay this account syncs through, and the handle it is known by
   * there — the local half of **binding a relay to an account that already
   * exists** (`bindRelayToAccount`, `model.md` §7.2).
   *
   * Separate from {@link create} because binding is not creation: an account
   * created locally already holds every key and verifier a relay needs (that is
   * why `enableSync` mints the auth verifier with no relay in sight), so
   * *"start syncing later"* adds two columns rather than a new ritual. Nothing
   * about the keys changes, which is what makes this a plain `UPDATE`.
   *
   * Separate from {@link updateCredentials} because that one answers a password
   * reset performed elsewhere. These two never want to run together: one changes
   * who you are to the relay, the other how you prove it.
   */
  bindRelay(input: { username: string; relayUrl: string }): Promise<void>;
  /** The single active account for this local store, or undefined before sync. */
  getSingleton(): Promise<Account | undefined>;
  /**
   * Remove the account identity from this device entirely — a hard delete, not a
   * soft delete, so re-enabling sync starts clean (the account row is
   * device-local identity and never syncs). The master key is unaffected; it
   * survives in its enclave wrapping. See `clearLocalAccount` in core.
   */
  clear(): Promise<void>;
}

/**
 * The account-identity repository (encryption-schema.md §2.1). One account per
 * local store (schema.md §4 — multi-account is out of scope), so reads are a
 * singleton. Written against the async {@link SqliteDriver} port so it runs
 * unchanged on desktop and mobile.
 */
export function createAccountRepo(driver: SqliteDriver): AccountRepo {
  return {
    async create(input) {
      const {
        id = crypto.randomUUID(),
        kdfSalt,
        authVerifier,
        kdfAlg,
        username = null,
        relayUrl = null,
        publicKey = null,
      } = createAccountInputSchema.parse(input);
      const now = Date.now();
      const account: Account = {
        id,
        publicKey,
        kdfSalt,
        authVerifier,
        kdfAlg,
        username,
        relayUrl,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO account
           (id, public_key, kdf_salt, auth_verifier, kdf_alg, username, relay_url,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          account.publicKey,
          account.kdfSalt,
          account.authVerifier,
          account.kdfAlg,
          account.username,
          account.relayUrl,
          account.createdAt,
          account.updatedAt,
          account.deletedAt,
        ],
      );
      return account;
    },

    async updateCredentials({ kdfSalt, authVerifier }) {
      await driver.run(
        `UPDATE account
            SET kdf_salt = ?, auth_verifier = ?, updated_at = ?
          WHERE deleted_at IS NULL`,
        [kdfSalt, authVerifier, Date.now()],
      );
    },

    async bindRelay({ username, relayUrl }) {
      await driver.run(
        `UPDATE account
            SET username = ?, relay_url = ?, updated_at = ?
          WHERE deleted_at IS NULL`,
        [username, relayUrl, Date.now()],
      );
    },

    async getSingleton() {
      const row = await driver.get<AccountRow>(
        "SELECT * FROM account WHERE deleted_at IS NULL LIMIT 1",
      );
      return row ? toAccount(row) : undefined;
    },

    async clear() {
      await driver.run("DELETE FROM account");
    },
  };
}

/** The `device` table row, exactly as stored (snake_case columns). */
interface DeviceRow {
  id: string;
  account_id: string;
  label: string | null;
  platform: string | null;
  public_key: Uint8Array | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toDevice(row: DeviceRow): Device {
  return deviceSchema.parse({
    id: row.id,
    accountId: row.account_id,
    label: row.label,
    platform: row.platform,
    publicKey: bytes(row.public_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export interface DeviceRepo {
  /**
   * Register a device on the account (custody Phase 2). Idempotent on the device
   * id — re-registering the same device returns the existing row, since the id
   * is the stable Phase-0 device id, not freshly minted here.
   */
  register(input: RegisterDeviceInput): Promise<Device>;
  get(id: string): Promise<Device | undefined>;
  list(): Promise<Device[]>;
  /**
   * Remove every device registration on this store — a hard delete, since
   * `device.id` is the stable Phase-0 PK and a soft-deleted row would collide
   * when {@link DeviceRepo.register} re-registers the same device after a reset.
   */
  clear(): Promise<void>;
}

/**
 * The device-registration repository (encryption-schema.md §2.2). Written
 * against the async {@link SqliteDriver} port so it runs unchanged on desktop
 * and mobile.
 */
export function createDeviceRepo(driver: SqliteDriver): DeviceRepo {
  const get = async (id: string): Promise<Device | undefined> => {
    const row = await driver.get<DeviceRow>(
      "SELECT * FROM device WHERE id = ? AND deleted_at IS NULL",
      [id],
    );
    return row ? toDevice(row) : undefined;
  };

  return {
    get,

    async register(input) {
      const {
        id,
        accountId,
        label = null,
        platform = null,
        publicKey = null,
      } = registerDeviceInputSchema.parse(input);
      const existing = await get(id);
      if (existing !== undefined) return existing;

      const now = Date.now();
      const device: Device = {
        id,
        accountId,
        label,
        platform,
        publicKey,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await driver.run(
        `INSERT INTO device
           (id, account_id, label, platform, public_key,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          device.id,
          device.accountId,
          device.label,
          device.platform,
          device.publicKey,
          device.createdAt,
          device.updatedAt,
          device.deletedAt,
        ],
      );
      return device;
    },

    async list() {
      const rows = await driver.all<DeviceRow>(
        "SELECT * FROM device WHERE deleted_at IS NULL ORDER BY created_at",
      );
      return rows.map(toDevice);
    },

    async clear() {
      await driver.run("DELETE FROM device");
    },
  };
}
