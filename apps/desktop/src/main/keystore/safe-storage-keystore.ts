import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import type { KeyStore } from "@leapsake/crypto";
import { safeStorage } from "electron";

/**
 * A {@link KeyStore} over `safeStorage`, which encrypts but persists nothing,
 * so this keeps one atomic JSON map of `id → base64(ciphertext)`.
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
