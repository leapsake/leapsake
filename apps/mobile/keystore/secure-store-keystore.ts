import { base64ToBytes, bytesToBase64, bytesToHex } from "@leapsake/bytes";
import type { KeyStore } from "@leapsake/crypto";
import * as SecureStore from "expo-secure-store";

/**
 * The mobile {@link KeyStore}, backed by `expo-secure-store`, which writes
 * straight into the OS vault (iOS Keychain / Android Keystore) and persists
 * itself. The counterpart to the desktop `safeStorage` adapter; `packages/crypto`
 * stays adapter-free so the port is implemented per-platform, like the SQLite
 * drivers. This is where the device's enclave secret lives — on-device, outside
 * the synced SQLite database (it is the one key the database cannot hold).
 *
 * `keychainAccessible: AFTER_FIRST_UNLOCK` keeps the secret reachable after the
 * first unlock following a reboot, which later background sync needs, while
 * still protecting it before that first unlock. **The accepted limit that comes
 * with it:** after that first unlock the secret is readable to anything running
 * on the device, so at-rest protection from then on leans entirely on the OS
 * lockscreen. A stricter class (`WHEN_UNLOCKED`) would trade background sync for
 * it; that trade has not been made. Values are base64 (secrets are
 * tiny — well under expo-secure-store's ~2048-byte per-value limit on Android,
 * which would matter only for much larger future blobs).
 */
// expo-secure-store keys are restricted to [A-Za-z0-9._-], but ids may carry a
// ':' (e.g. 'payload:<uuid>'), so hex-encode the id into a safe storage key.
function keyFor(id: string): string {
  return bytesToHex(new TextEncoder().encode(id));
}

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
