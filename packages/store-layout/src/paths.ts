// Store paths relative to the app-data root. ⚠️ The only place a store path is
// spelled out; nothing else may contain `leapsake.db`.

/** The store filename, identical in every location. */
const STORE_FILE = "leapsake.db";

/** The directory holding every per-account store. */
const STORES_DIR = "stores";

/** The plaintext store's reserved slot, which no UUID account id can match. */
export const UNAUTHENTICATED_STORE_SLOT = "local";

/** The directory for one account's store, relative to the app-data root. */
export function storeDir(slot: string): string {
  return `${STORES_DIR}/${slot}`;
}

/** The store file for one account, relative to the app-data root. */
export function storePath(slot: string): string {
  return `${storeDir(slot)}/${STORE_FILE}`;
}

/** The roster file, outside `stores/`, readable before any store. */
export const ROSTER_PATH = "accounts.json";
