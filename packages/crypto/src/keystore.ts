/**
 * The `KeyStore` port (encryption.md §13): the small async surface for secrets
 * the device holds outside the database — the enclave-wrapping secret today,
 * passphrase-derived material later. Async so the same port covers desktop
 * `safeStorage` and mobile `expo-secure-store`; this slice ships only the
 * in-memory adapter, with the OS-backed ones a later step.
 */
export interface KeyStore {
  /** Return the secret stored under `id`, or `undefined` if absent. */
  getSecret(id: string): Promise<Uint8Array | undefined>;
  /** Store `bytes` under `id`, replacing any existing value. */
  setSecret(id: string, bytes: Uint8Array): Promise<void>;
  /** Remove the secret stored under `id`, if any. */
  deleteSecret(id: string): Promise<void>;
}

/**
 * An in-memory {@link KeyStore} for tests and the envelope slice. Copies bytes
 * in and out so callers can't mutate stored secrets through a retained
 * reference — the same defensive-copy contract a real OS keychain gives.
 */
export function createInMemoryKeyStore(): KeyStore {
  const store = new Map<string, Uint8Array>();
  return {
    async getSecret(id) {
      const bytes = store.get(id);
      return bytes ? Uint8Array.from(bytes) : undefined;
    },
    async setSecret(id, bytes) {
      store.set(id, Uint8Array.from(bytes));
    },
    async deleteSecret(id) {
      store.delete(id);
    },
  };
}
