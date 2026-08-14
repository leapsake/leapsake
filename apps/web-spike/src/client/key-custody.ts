import type { KeyStore } from "@leapsake/crypto";
import type { EncryptedRecord } from "@leapsake/sync";

/**
 * **Increment 5e**: what a browser has instead of an enclave — written as the
 * `KeyStore` port, because that turned out to be exactly what it is.
 *
 * §13 of `plans/encryption/model.md` gives every client a row in one table and
 * abstracts the differences behind a **`KeyStore`**: `getSecret` /`setSecret` /
 * `deleteSecret`, bytes in and bytes out, async so the same port covers
 * desktop's `safeStorage` and mobile's `expo-secure-store`. The browser's row
 * reads **"weak — IndexedDB, no enclave → passkey PRF is the right answer."**
 * This module probes the cheaper thing first, because it costs half an hour and
 * every browser that can run the rest of this client already has it: a
 * **non-extractable `CryptoKey` in IndexedDB**, wrapping each secret.
 *
 * {@link createBrowserKeyStore} is that adapter, and it implements
 * `@leapsake/crypto`'s port with **no change to the port** — which is the
 * increment's structural finding, and the same shape as every other one this
 * spike has produced: the ports were not desktop-shaped, so a third host
 * satisfies them as written.
 *
 * ## Why a non-extractable key is worth anything at all
 *
 * A `CryptoKey` generated with `extractable: false` is a *handle*, not a value:
 * WebCrypto will encrypt and decrypt with it and will refuse to hand its bytes
 * to JavaScript, `exportKey` included. It is also structured-cloneable, so
 * IndexedDB stores the handle while the browser keeps the key material
 * somewhere JavaScript cannot address. What survives a reload is therefore the
 * *ability to unwrap*, not a secret sitting in a database row — and what an
 * attacker who can read IndexedDB (an XSS payload, another script on the origin)
 * walks away with is a wrap they cannot open anywhere else.
 *
 * The honest limits, stated here rather than discovered later:
 *
 * - **Same-origin script can still use the key**, because that is the point of
 *   it. Non-extractable buys "the key cannot be exfiltrated", not "the key
 *   cannot be used by whatever is running on this origin". An enclave with user
 *   presence — passkey PRF — is what buys the second, and it stays §13's
 *   designed answer.
 * - **The master key is bytes in JS memory once unwrapped**, because
 *   `@leapsake/crypto` seals and opens with `Uint8Array`s, and the port itself
 *   is defined in bytes. That is why the wrap is AES-GCM over the raw secret
 *   rather than `AES-KW`: `AES-KW`'s selling point is that the wrapped key never
 *   materializes as bytes, and no client of this port can have that property.
 * - **IndexedDB is evictable** — see {@link storageStatus}, which found that the
 *   thread owning the data is not allowed to ask for durability.
 */

const DB_NAME = "leapsake-spike-custody";
const SECRETS = "secrets";
const ACCOUNT = "account";
/** One account per browser profile here, as on a real install. */
const ACCOUNT_KEY = "current";

/** The two ids this client keeps, named as a `KeyStore` caller would name them. */
export const MASTER_KEY = "master-key";
/**
 * The relay credential, and it is in custody for the same reason §9.2 wraps it
 * into the SSR host's session rather than leaving it beside the master key: it
 * is a **standing credential**, and a warm start that can read the local store
 * but can never sync again is not a warm start.
 */
export const AUTH_VERIFIER = "auth-verifier";

/** AES-GCM wants a 96-bit nonce, fresh per encryption. */
const IV_BYTES = 12;

/** One secret at rest: the handle that opens it, and what it opens. */
interface SecretRecord {
  /** Non-extractable, and the reason this is not just a file of secrets. */
  wrappingKey: CryptoKey;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/** One relay record, kept exactly as it arrived — see {@link AccountRecord}. */
export interface Canary {
  table: string;
  id: string;
  ciphertext: Uint8Array;
}

/**
 * What the browser needs to *find* its data, as distinct from what it needs to
 * decrypt it. None of it is secret, and it deliberately does not go through the
 * `KeyStore`: the account id names the OPFS file before anything is unwrapped,
 * and the relay knows it anyway.
 *
 * The canary is the increment's evidence and deserves the underline: sealing a
 * value with a key and then opening it with the same key proves the wrap works
 * and nothing else. Opening a record **the relay produced**, and finding a row
 * the OPFS store also holds, proves the key is the account's.
 */
interface AccountRecord {
  accountId: string;
  canary: Canary | null;
  mintedAt: number;
}

// --- IndexedDB, in the twenty lines it takes without a library ---------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 2: the first cut kept one record holding both secrets and the
    // metadata, before the port made the split obvious. Creating stores
    // conditionally rather than assuming a fresh database, because a browser
    // that ran the earlier version has the old one and `onupgradeneeded` is the
    // only place this is allowed to be fixed.
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      for (const name of [SECRETS, ACCOUNT]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      if (db.objectStoreNames.contains("custody")) db.deleteObjectStore("custody");
    };
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error("indexedDB.open failed"));
    };
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store));
        request.onsuccess = (): void => {
          resolve(request.result as T);
          db.close();
        };
        request.onerror = (): void => {
          reject(request.error ?? new Error("IndexedDB request failed"));
          db.close();
        };
      }),
  );
}

// --- The port ----------------------------------------------------------------

/**
 * `@leapsake/crypto`'s {@link KeyStore}, implemented for a browser: every secret
 * is stored under **its own** freshly generated non-extractable `CryptoKey`.
 *
 * Per-secret keys rather than one shared wrapping key because it costs nothing
 * (generation is sub-millisecond) and it makes `deleteSecret` complete: dropping
 * the record drops the only reference to the handle, so the browser is free to
 * forget the key material with it. There is no "the wrapping key is still around
 * somewhere" to reason about.
 *
 * The defensive-copy contract the in-memory adapter documents is free here —
 * every value crosses `structuredClone` on the way into IndexedDB and comes back
 * as fresh bytes out of `crypto.subtle.decrypt`.
 */
export function createBrowserKeyStore(): KeyStore {
  return {
    async getSecret(id) {
      const record = await run<SecretRecord | undefined>(SECRETS, "readonly", (store) =>
        store.get(id),
      );
      if (record === undefined) return undefined;
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv },
        record.wrappingKey,
        record.ciphertext,
      );
      return new Uint8Array(plaintext);
    },

    async setSecret(id, bytes) {
      const wrappingKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        // The flag this whole module is about.
        false,
        ["encrypt", "decrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        wrappingKey,
        bytes,
      );
      const record: SecretRecord = {
        wrappingKey,
        iv,
        ciphertext: new Uint8Array(ciphertext),
      };
      await run(SECRETS, "readwrite", (store) => store.put(record, id));
    },

    async deleteSecret(id) {
      await run(SECRETS, "readwrite", (store) => store.delete(id));
    },
  };
}

/**
 * Ask WebCrypto for a stored secret's wrapping key bytes, and report what it
 * said.
 *
 * The whole claim of this increment is a negative one, so it is checked rather
 * than asserted: a key minted `extractable: false` must make `exportKey` throw
 * `InvalidAccessError`. If it ever returns bytes, the page says so in its
 * verdict and the answer to "what is the browser's `KeyStore`?" is different.
 * This reaches around the port deliberately — `KeyStore` has no notion of *how*
 * a secret is protected, which is exactly why the spike has to look.
 */
export async function probeKeyProtection(id: string): Promise<string> {
  const record = await run<SecretRecord | undefined>(SECRETS, "readonly", (store) =>
    store.get(id),
  );
  if (record === undefined) return `no secret stored under "${id}"`;
  try {
    const raw = await crypto.subtle.exportKey("raw", record.wrappingKey);
    return `⚠︎ exportKey returned ${raw.byteLength} bytes — the key is NOT protected`;
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return `exportKey refused (${name}) — extractable: ${String(record.wrappingKey.extractable)}`;
  }
}

// --- Custody, which is the port plus the metadata a client needs to start -----

export interface Custody {
  accountId: string;
  masterKey: Uint8Array;
  authVerifier: Uint8Array;
  canary: Canary | null;
  mintedAt: number;
  /** What `exportKey` did when asked for the master key's wrapping key. */
  extractability: string;
}

/**
 * The last act of a password login: hand the next load everything it needs to
 * skip the password login.
 *
 * Two `setSecret` calls and one metadata row — and the two `setSecret` calls are
 * the whole of the key handling, which is the point of having a port.
 */
export async function saveCustody(opts: {
  accountId: string;
  masterKey: Uint8Array;
  authVerifier: Uint8Array;
  canary: Canary | null;
}): Promise<{ ms: number; extractability: string }> {
  const started = performance.now();
  const keys = createBrowserKeyStore();
  await keys.setSecret(MASTER_KEY, opts.masterKey);
  await keys.setSecret(AUTH_VERIFIER, opts.authVerifier);

  // A reload's login pulls nothing, so it produces no canary — keep the one the
  // cold login stored rather than dropping the evidence on every reload.
  const previous = await run<AccountRecord | undefined>(ACCOUNT, "readonly", (store) =>
    store.get(ACCOUNT_KEY),
  );
  const record: AccountRecord = {
    accountId: opts.accountId,
    canary:
      opts.canary ??
      (previous?.accountId === opts.accountId ? (previous.canary ?? null) : null),
    mintedAt: Date.now(),
  };
  await run(ACCOUNT, "readwrite", (store) => store.put(record, ACCOUNT_KEY));

  return {
    ms: Math.round((performance.now() - started) * 10) / 10,
    extractability: await probeKeyProtection(MASTER_KEY),
  };
}

/** The warm start's first move: the wrap, opened, with no password in sight. */
export async function loadCustody(): Promise<Custody | null> {
  const account = await run<AccountRecord | undefined>(ACCOUNT, "readonly", (store) =>
    store.get(ACCOUNT_KEY),
  );
  if (account === undefined) return null;

  const keys = createBrowserKeyStore();
  const masterKey = await keys.getSecret(MASTER_KEY);
  const authVerifier = await keys.getSecret(AUTH_VERIFIER);
  if (masterKey === undefined || authVerifier === undefined) return null;

  return {
    accountId: account.accountId,
    masterKey,
    authVerifier,
    canary: account.canary,
    mintedAt: account.mintedAt,
    extractability: await probeKeyProtection(MASTER_KEY),
  };
}

/** Is there anything to resume from? Answered without unwrapping anything. */
export async function peekCustody(): Promise<{
  accountId: string;
  mintedAt: number;
} | null> {
  const account = await run<AccountRecord | undefined>(ACCOUNT, "readonly", (store) =>
    store.get(ACCOUNT_KEY),
  );
  return account === undefined
    ? null
    : { accountId: account.accountId, mintedAt: account.mintedAt };
}

/**
 * Drop the wrap — the logout half of custody, and the thing a shared computer
 * needs. `deleteSecret` drops the only reference to each `CryptoKey` handle, so
 * the browser is free to forget the key material with it.
 */
export async function forgetCustody(): Promise<void> {
  const keys = createBrowserKeyStore();
  await keys.deleteSecret(MASTER_KEY);
  await keys.deleteSecret(AUTH_VERIFIER);
  await run(ACCOUNT, "readwrite", (store) => store.delete(ACCOUNT_KEY));
}

/** Pick the record kept as proof — a live person row, not a tombstone. */
export function pickCanary(records: readonly EncryptedRecord[]): Canary | null {
  const record = records.find(
    (candidate) => candidate.table === "people" && candidate.deletedAt === null,
  );
  return record === undefined
    ? null
    : { table: record.table, id: record.id, ciphertext: record.ciphertext };
}

// --- Whether any of it survives the week --------------------------------------

/**
 * Report — and, where the caller is allowed to, request — the durable storage
 * bucket, so the browser does not evict the wrap or the OPFS database beside it.
 *
 * **`persist()` is `[Exposed=Window]`.** A worker gets `persisted()` and
 * `estimate()` and no way to ask, which was found by running this in the worker
 * and reading "unavailable" back. It is a real constraint on a PWA rather than a
 * spike detail: the thread that owns the database cannot protect it, so the
 * *page* has to make the request — one more thing a real client's startup owes,
 * beside the manifest and the service worker.
 *
 * Reported rather than required either way: Chrome grants it silently to an
 * installed or engaged origin, Firefox prompts, Safari does neither. A client
 * that treated a refusal as fatal would be wrong — eviction costs one Argon2id,
 * not an account.
 */
export async function storageStatus(): Promise<string> {
  const storage: StorageManager | undefined = navigator.storage;
  if (storage?.persisted === undefined) return "navigator.storage is unavailable";

  const estimate = await storage.estimate?.();
  const used =
    estimate?.usage === undefined
      ? ""
      : `, ${(estimate.usage / 1024 / 1024).toFixed(1)} MiB used of ${(
          (estimate.quota ?? 0) /
          1024 /
          1024 /
          1024
        ).toFixed(1)} GiB`;

  const already = await storage.persisted();
  if (already) return `persistent storage, already granted${used}`;
  if (typeof storage.persist !== "function") {
    return `best-effort (evictable) storage — persist() is Window-only, so this thread cannot ask${used}`;
  }
  const granted = await storage.persist();
  return `${granted ? "persistent storage, just granted" : "best-effort (evictable) storage — persist() was refused"}${used}`;
}
