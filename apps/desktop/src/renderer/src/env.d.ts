import type { Account, Api, AppEvents, Boot, Data, Sync } from "../../preload";

declare global {
  interface Window {
    api: Api;
    account: Account;
    boot: Boot;
    app: AppEvents;
    data: Data;
    /** Present only under the sync preview's flag. */
    sync?: Sync;
  }
}
