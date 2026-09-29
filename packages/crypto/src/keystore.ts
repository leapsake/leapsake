/** The async port for secrets held outside the database, which each app
 *  implements over its OS keychain. */
export interface KeyStore {
  /** The secret stored under `id`, or `undefined`. */
  getSecret(id: string): Promise<Uint8Array | undefined>;
  /** Stores `bytes` under `id`, replacing any value. */
  setSecret(id: string, bytes: Uint8Array): Promise<void>;
  /** Removes the secret stored under `id`, if any. */
  deleteSecret(id: string): Promise<void>;
}

/** An in-memory {@link KeyStore} that copies bytes in and out, as a real
 *  keychain effectively does. */
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
