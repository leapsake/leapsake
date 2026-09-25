import {
  type AdoptionDoor,
  type BootKeySession,
  type SqliteDriver,
  type UnlockAnswer,
  type UnlockRequest,
  establishKeySession,
  resealRecoveryDoor,
  unlockStore,
} from "@leapsake/core";
import {
  DATABASE_KEY,
  type KeyStore,
  ensureDatabaseKey,
} from "@leapsake/crypto";
import {
  type ActiveStore,
  type RosterEntry,
  UNAUTHENTICATED_STORE_SLOT,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";

/** The part of an account's doors the boot reads and reseals. */
export interface BootDoors {
  readPassword(): Promise<Uint8Array | undefined>;
  readRecovery(): Promise<Uint8Array | undefined>;
  writeRecovery(bytes: Uint8Array): Promise<void>;
}

export interface OpenActiveStorePorts<Doors extends BootDoors> {
  keyStore: KeyStore;
  listAccounts(): Promise<readonly RosterEntry[]>;
  doorsFor(accountId: string): Doors;
  destroyStore(path: string): Promise<void>;
  /** Open the store at `path`, keyed when `dbKey` is set, and migrate it. */
  openStore(path: string, dbKey: Uint8Array | undefined): Promise<SqliteDriver>;
  ask(request: UnlockRequest): Promise<UnlockAnswer>;
  /** Called once a door has opened the db-key, before the store is opened. */
  onUnlocked(): void;
  platform: string;
}

/**
 * Open the store the roster points at: keyless when Unauthenticated, else under
 * the enclave's db-key, a door's, or a newly minted one for a store not yet made.
 */
export async function openActiveStore<Doors extends BootDoors>(
  ports: OpenActiveStorePorts<Doors>,
): Promise<{
  activeStore: ActiveStore;
  driver: SqliteDriver;
  doors: Doors | undefined;
  established: BootKeySession;
}> {
  const { keyStore, ask, platform } = ports;

  const activeStore = resolveActiveStore({
    accounts: await ports.listAccounts(),
  });
  const existingDbKey = await keyStore.getSecret(DATABASE_KEY);

  const doors =
    activeStore.custody === "encrypted" && activeStore.accountId !== undefined
      ? ports.doorsFor(activeStore.accountId)
      : undefined;
  const recoverySidecar = await doors?.readRecovery();
  const passwordSidecar = await doors?.readPassword();

  // An Authenticated launch sweeps the plaintext store a conversion failed to delete.
  if (activeStore.custody === "encrypted") {
    try {
      await ports.destroyStore(storePath(UNAUTHENTICATED_STORE_SLOT));
    } catch {
      // Nothing to sweep, the ordinary case.
    }
  }

  let dbKey = activeStore.custody === "encrypted" ? existingDbKey : undefined;
  let unlockedBy: AdoptionDoor | undefined;
  if (
    activeStore.custody === "encrypted" &&
    dbKey === undefined &&
    (recoverySidecar !== undefined || passwordSidecar !== undefined)
  ) {
    const unlocked = await unlockStore(
      { password: passwordSidecar, phrase: recoverySidecar },
      ask,
    );
    dbKey = unlocked.dbKey;
    unlockedBy = unlocked.door;
    await keyStore.setSecret(DATABASE_KEY, dbKey);
    ports.onUnlocked();
  }
  if (activeStore.custody === "encrypted" && dbKey === undefined)
    dbKey = await ensureDatabaseKey(keyStore);

  const driver = await ports.openStore(activeStore.path, dbKey);

  const established = await establishKeySession({
    keyStore,
    driver,
    custody: activeStore.custody,
    door: unlockedBy,
    platform,
  });

  if (dbKey !== undefined && doors !== undefined) {
    await resealRecoveryDoor({
      keyStore,
      dbKey,
      door: unlockedBy,
      writeRecovery: (bytes) => doors.writeRecovery(bytes),
    });
  }

  return { activeStore, driver, doors, established };
}
