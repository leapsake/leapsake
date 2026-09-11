import type { SqliteDriver } from "./driver.js";

/**
 * Durable persistence for the {@link SyncEngine}'s two watermarks, so a fresh
 * engine on the same database resumes exactly where it left off instead of
 * re-pushing or re-pulling from zero (plans/encryption/sync.md).
 *
 * It is backed by the device-local `sync_state` table (migration 13), a plain
 * key/value store. That table carries none of the sync substrate and is *never*
 * registered as a {@link SyncableRepo} — these marks are per-device and must not
 * replicate (model.md §3), exactly like the `content_key`/`key_wrap` tables.
 *
 * - `push_hwm` — the epoch-ms high-water mark of rows already sealed and pushed.
 * - `pull_cursor` — the transport's opaque delivery cursor already consumed.
 * - `auto_sync_disabled` — the per-client "Sync automatically" preference, stored
 *   *inverted* so that a missing row (= `0`) reads as **enabled**, giving the
 *   default-ON behaviour for free. `1` = the user turned automatic sync off on
 *   this install. Like the watermarks it is device-local and never replicates.
 * - `recovery_escrow_pending` — set by an offline recovery-phrase rotation, so the
 *   next sync carries the new escrow to the relay.
 *
 * A missing row reads as `0`, which is the documented floor for both:
 * `push(0)` collects every local row and `pull(0)` returns the whole log (see
 * `@leapsake/sync`, where transport sequences start at 1).
 */
export interface SyncStateRepo {
  getPushHwm(): Promise<number>;
  setPushHwm(value: number): Promise<void>;
  getPullCursor(): Promise<number>;
  setPullCursor(value: number): Promise<void>;
  /** Whether automatic background sync is enabled on this install (default true). */
  getAutoSyncEnabled(): Promise<boolean>;
  setAutoSyncEnabled(enabled: boolean): Promise<void>;
  /**
   * The bundled holiday-catalog version this install has already seeded
   * (`0` = never). Device-local by construction, which is exactly what the seed
   * gate needs: "has *this device* applied *this bundle*" is a fact about the
   * install, not about the account.
   *
   * The alternative — deciding whether to seed by checking whether holiday rows
   * exist — is wrong in two ways at once (`@leapsake/holidays` README, the invariants): a device
   * that received the catalog via sync would re-seed from its own stale bundle,
   * and holidays the user deleted would come back.
   *
   * An integer, because that is what this table's `value` column holds. That
   * forecloses a semver catalog version, which is the natural instinct.
   */
  getHolidayCatalogVersion(): Promise<number>;
  setHolidayCatalogVersion(version: number): Promise<void>;
  /**
   * Whether this device has rotated its recovery phrase without yet telling the
   * relay (custody slice 8, `model.md` §6). Rotation is deliberately offline-
   * capable: it re-seals the local doors immediately and leaves this flag for the
   * next sync to carry the new escrow up.
   *
   * Device-local like everything else here, and necessarily so — it is a fact
   * about *this* device's outbox, not about the account.
   */
  getRecoveryEscrowPending(): Promise<boolean>;
  setRecoveryEscrowPending(pending: boolean): Promise<void>;
  /**
   * Whether this device's key custody is **unfinished** (custody slice 10,
   * `model.md` §7.5): set while a door unlock is re-adopting the account's master
   * key, and left set when that repair could not complete — which is what puts the
   * device in the *Degraded* state, syncing nothing until it is resolved.
   *
   * It exists because the repair is two durable steps, not one. Adopting the key
   * commits a `key_wrap` row; rewinding the watermarks
   * (`resyncAfterMasterKeyRepair`) is a separate write, and a crash between them
   * leaves a device holding the *right* key with its history quietly holed — the
   * exact damage the repair exists to undo. The flag spans the pair, so the next
   * boot finishes it.
   *
   * Device-local like everything else here, and necessarily so: it is a fact about
   * *this* device's enclave, not about the account.
   */
  getMasterKeyRepairPending(): Promise<boolean>;
  setMasterKeyRepairPending(pending: boolean): Promise<void>;
  /**
   * Whether this device keeps its People in step with the phone's address book
   * — switched on the first time the user imports from it, and read at every
   * boot and foreground before the address book is touched.
   *
   * Opt-in rather than "whenever permission is granted" so that a factory reset
   * (which drops this row with the store) does not quietly refill a store the
   * user just emptied. Device-local because the address book it names is.
   */
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
    // Stored inverted (see the interface doc): absent/0 ⇒ enabled, 1 ⇒ disabled.
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
    // Also not inverted: absent/0 ⇒ nothing to finish, which is the right default
    // for every device that never lost its keychain.
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
