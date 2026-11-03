import type { KeyStore } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import type { AccountRoster } from "@leapsake/store-layout";

/** Where each client keeps a store's bytes and doors, and how it copies one
 *  under a new key; everything else about an account flow is shared. */
export interface StoreFiles {
  /** Close the open store's handle, so its file can be copied. */
  close(): Promise<void>;
  /** Copy the open plaintext store into a new encrypted store in
   *  `accountId`'s slot, under `dbKey`, keeping the original. */
  convertToEncrypted(accountId: string, dbKey: Uint8Array): Promise<void>;
  /** Copy one account's encrypted store into another's slot under the same
   *  `dbKey`, keeping the original. */
  copyAccountStore(
    fromAccountId: string,
    toAccountId: string,
    dbKey: Uint8Array,
  ): Promise<void>;
  /** Open `accountId`'s store under `dbKey`, writing nothing to it. */
  openAccountStore(accountId: string, dbKey: Uint8Array): Promise<SqliteDriver>;
  /** Write the password door beside `accountId`'s store. */
  writePasswordDoor(accountId: string, door: Uint8Array): Promise<void>;
  /** Remove `accountId`'s store and doors; nothing there is a success. */
  removeAccountStore(accountId: string): Promise<void>;
  /** Remove the plaintext store a conversion copied. */
  removePlaintextStore(): Promise<void>;
}

/** What a client binds once per open store. */
export interface AccountFlowPorts {
  keyStore: KeyStore;
  /** The open store. */
  driver: SqliteDriver;
  /** Whether the open store's file is encrypted, from `resolveActiveStore`. */
  custody: "plaintext" | "encrypted";
  roster: AccountRoster;
  files: StoreFiles;
  platform: string;
}
