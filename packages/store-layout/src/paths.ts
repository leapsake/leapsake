/**
 * Where a client keeps its stores (encryption `model.md` §7.4). Pure string
 * derivation, deliberately free of any filesystem: desktop joins these onto
 * `app.getPath("userData")`, mobile onto expo-sqlite's database directory, and
 * tests onto a temp dir.
 *
 * The load-bearing rule the design states — *"new work must not assume a single
 * fixed database path"* — is enforced by this module being the only place a store
 * location is spelled out. Nothing else in the app should contain the string
 * `leapsake.db`.
 */

/** The store filename, identical in every location. */
const STORE_FILE = "leapsake.db";

/** The directory holding every per-account store. */
const STORES_DIR = "stores";

/**
 * The Open store's slot (§7.2) — the one plaintext store a client may hold before
 * any account exists. It is a reserved slot rather than an account id, which is
 * why it can never collide with one: account ids are UUIDs.
 */
export const OPEN_STORE_SLOT = "local";

/**
 * The pre-custody store location: a bare `leapsake.db` beside the keystore, which
 * is where every build before the custody work put its (always-encrypted) store.
 * Installs predating that change keep opening from here — see
 * {@link resolveActiveStore}. Nothing new is ever written to this path.
 */
export const LEGACY_STORE_PATH = STORE_FILE;

/** The directory for one account's store, relative to the app-data root. */
export function storeDir(slot: string): string {
  return `${STORES_DIR}/${slot}`;
}

/** The store file for one account, relative to the app-data root. */
export function storePath(slot: string): string {
  return `${storeDir(slot)}/${STORE_FILE}`;
}

/**
 * The roster file, relative to the app-data root (§7.4). It sits *outside*
 * `stores/` on purpose: it must be readable before — and independently of — any
 * store, since you cannot enumerate accounts from inside files you cannot decrypt.
 */
export const ROSTER_PATH = "accounts.json";
