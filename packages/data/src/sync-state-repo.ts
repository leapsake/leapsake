import type { SqliteDriver } from "./driver.js";

/** Device-local key/value state that must never replicate: the sync
 *  watermarks and per-install flags (README, "The sync substrate"). */
export interface SyncStateRepo {
  getPushHwm(): Promise<number>;
  setPushHwm(value: number): Promise<void>;
  getPullCursor(): Promise<number>;
  setPullCursor(value: number): Promise<void>;
  /** Whether automatic background sync is enabled on this install (default
   *  true). */
  getAutoSyncEnabled(): Promise<boolean>;
  setAutoSyncEnabled(enabled: boolean): Promise<void>;
  /** The holiday-catalog version this install has seeded; `0` = never. */
  getHolidayCatalogVersion(): Promise<number>;
  setHolidayCatalogVersion(version: number): Promise<void>;
  /** Whether an offline phrase rotation still owes the relay its new escrow. */
  getRecoveryEscrowPending(): Promise<boolean>;
  setRecoveryEscrowPending(pending: boolean): Promise<void>;
  /** Whether a master-key repair is unfinished: set across adopt and rewind,
   *  so a crash between them is completed on the next boot. */
  getMasterKeyRepairPending(): Promise<boolean>;
  setMasterKeyRepairPending(pending: boolean): Promise<void>;
  /** Whether this device keeps People in step with its address book; switched
   *  on by the first import. */
  getDeviceContactsSync(): Promise<boolean>;
  setDeviceContactsSync(enabled: boolean): Promise<void>;
}

const PUSH_HWM = "push_hwm";
const PULL_CURSOR = "pull_cursor";
const AUTO_SYNC_DISABLED = "auto_sync_disabled";
const HOLIDAY_CATALOG_VERSION = "holiday_catalog_version";
const RECOVERY_ESCROW_PENDING = "recovery_escrow_pending";
const MASTER_KEY_REPAIR_PENDING = "master_key_repair_pending";
const DEVICE_CONTACTS_SYNC = "device_contacts_sync";

export function createSyncStateRepo(driver: SqliteDriver): SyncStateRepo {
  async function read(key: string): Promise<number> {
    const row = await driver.get<{ value: number }>(
      "SELECT value FROM sync_state WHERE key = ?",
      [key],
    );
    return row?.value ?? 0;
  }

  async function write(key: string, value: number): Promise<void> {
    // Upsert — portable across node:sqlite and expo-sqlite (matches the
    // partial-index/portability constraint the migrations are written to).
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value],
    );
  }

  return {
    getPushHwm: () => read(PUSH_HWM),
    setPushHwm: (value) => write(PUSH_HWM, value),
    getPullCursor: () => read(PULL_CURSOR),
    setPullCursor: (value) => write(PULL_CURSOR, value),
    // Stored inverted (see the interface doc): absent/0 ⇒ enabled, 1 ⇒
    // disabled.
    getAutoSyncEnabled: async () => (await read(AUTO_SYNC_DISABLED)) !== 1,
    setAutoSyncEnabled: (enabled) => write(AUTO_SYNC_DISABLED, enabled ? 0 : 1),
    getHolidayCatalogVersion: () => read(HOLIDAY_CATALOG_VERSION),
    setHolidayCatalogVersion: (version) =>
      write(HOLIDAY_CATALOG_VERSION, version),
    // Not inverted, unlike `auto_sync_disabled`: absent/0 ⇒ nothing to flush is
    // the right default for a device that has never rotated.
    getRecoveryEscrowPending: async () =>
      (await read(RECOVERY_ESCROW_PENDING)) === 1,
    setRecoveryEscrowPending: (pending) =>
      write(RECOVERY_ESCROW_PENDING, pending ? 1 : 0),
    // Also not inverted: absent/0 ⇒ nothing to finish, which is the right
    // default for every device that never lost its keychain.
    getMasterKeyRepairPending: async () =>
      (await read(MASTER_KEY_REPAIR_PENDING)) === 1,
    setMasterKeyRepairPending: (pending) =>
      write(MASTER_KEY_REPAIR_PENDING, pending ? 1 : 0),
    // Not inverted: absent/0 ⇒ off, which is what a device that has never
    // imported from its contacts must read.
    getDeviceContactsSync: async () => (await read(DEVICE_CONTACTS_SYNC)) === 1,
    setDeviceContactsSync: (enabled) =>
      write(DEVICE_CONTACTS_SYNC, enabled ? 1 : 0),
  };
}
