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

/** node:sqlite returns BLOBs as Buffers; normalize to a plain Uint8Array. */
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
  /** Create the account row (custody Phase 1); fails the singleton if one
   *  exists. */
  create(input: CreateAccountInput): Promise<Account>;
  /** Replace the salt and auth verifier after a password reset elsewhere; the
   *  master key is untouched. A no-op with no account. */
  updateCredentials(input: {
    kdfSalt: Uint8Array;
    authVerifier: Uint8Array;
  }): Promise<void>;
  /** Record the relay and handle an existing account is bound to. Keys do not
   *  change, so this is a plain `UPDATE`. */
  bindRelay(input: { username: string; relayUrl: string }): Promise<void>;
  /** This store's single active account, or undefined before one exists. */
  getSingleton(): Promise<Account | undefined>;
  /** Hard-delete the account row, so re-creating one starts clean. */
  clear(): Promise<void>;
}

/** The account singleton: one per store. No row is the normal
 *  Unauthenticated state, not a corrupt one. */
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
  /** Register a device, idempotent on its stable id. */
  register(input: RegisterDeviceInput): Promise<Device>;
  get(id: string): Promise<Device | undefined>;
  list(): Promise<Device[]>;
  /** Hard-delete every device row: a tombstone would collide when the same
   *  stable id registers again. */
  clear(): Promise<void>;
}

/** The device-registration repository. */
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
