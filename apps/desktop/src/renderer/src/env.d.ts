import type { Account, Api, AppEvents, Boot, Data } from "../../preload";

declare global {
  interface Window {
    api: Api;
    account: Account;
    boot: Boot;
    app: AppEvents;
    data: Data;
  }
}
