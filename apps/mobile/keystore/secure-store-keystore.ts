import { base64ToBytes, bytesToBase64, bytesToHex } from "@leapsake/bytes";
import type { KeyStore } from "@leapsake/crypto";
import * as SecureStore from "expo-secure-store";

// expo-secure-store keys are restricted to [A-Za-z0-9._-], but ids may carry a
// ':' (e.g. 'payload:<uuid>'), so hex-encode the id into a safe storage key.
function keyFor(id: string): string {
  return bytesToHex(new TextEncoder().encode(id));
}

/** The OS keychain; its accessibility class is in the app's README. Values
 *  are base64, well under Android's ~2 KB limit. */
export function secureStoreKeyStore(): KeyStore {
  return {
    async getSecret(id) {
      const stored = await SecureStore.getItemAsync(keyFor(id));
      return stored === null ? undefined : base64ToBytes(stored);
    },

    async setSecret(id, bytes) {
      await SecureStore.setItemAsync(keyFor(id), bytesToBase64(bytes), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    },

    async deleteSecret(id) {
      await SecureStore.deleteItemAsync(keyFor(id));
    },
  };
}
