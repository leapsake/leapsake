import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import type { KeyStore } from "@leapsake/crypto";
import { safeStorage } from "electron";

/**
 * The desktop {@link KeyStore}, backed by Electron's first-party `safeStorage`.
 * The counterpart to the mobile `expo-secure-store` adapter; `packages/crypto`
 * stays adapter-free so the port is implemented per-platform, exactly like the
 * SQLite drivers.
 *
 * `safeStorage` encrypts/decrypts with a key derived from the OS keychain but
 * persists nothing, so this adapter owns persistence: one JSON map of
 * `id → base64(ciphertext)` at `filePath` (under `app.getPath("userData")`).
 * The stored blob is useless if copied off the machine — decryption needs this
 * OS account's keychain. The device's enclave secret must live here, outside
 * the synced SQLite database (it is the one key the database cannot hold).
 *
 * Writes are whole-file and atomic (temp file + rename). No locking is needed:
 * the Electron main process is single-threaded and every method below resolves
 * synchronously, so calls never interleave mid-write.
 */
type SecretMap = Record<string, string>;

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "safeStorage encryption is unavailable on this platform/session",
    );
  }
}

export function safeStorageKeyStore(filePath: string): KeyStore {
  function load(): SecretMap {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      // A missing file is the first-run empty store; anything else is real.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    return JSON.parse(raw) as SecretMap;
  }

  function save(map: SecretMap): void {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(map), "utf8");
    renameSync(tmp, filePath);
  }

  return {
    async getSecret(id) {
      const stored = load()[id];
      if (stored === undefined) return undefined;
      assertAvailable();
      // ciphertext → base64 string the secret was encoded as → raw bytes.
      const plaintextB64 = safeStorage.decryptString(
        Buffer.from(base64ToBytes(stored)),
      );
      return base64ToBytes(plaintextB64);
    },

    async setSecret(id, bytes) {
      assertAvailable();
      // Encrypt the secret's base64 form (safeStorage works on strings), then
      // store the resulting ciphertext bytes as base64 in the JSON map.
      const ciphertext = safeStorage.encryptString(bytesToBase64(bytes));
      const map = load();
      map[id] = bytesToBase64(new Uint8Array(ciphertext));
      save(map);
    },

    async deleteSecret(id) {
      const map = load();
      if (id in map) {
        delete map[id];
        save(map);
      }
    },
  };
}
