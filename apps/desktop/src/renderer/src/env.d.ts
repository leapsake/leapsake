import type { Account, Api, AppEvents, Boot } from "../../preload";

declare global {
  interface Window {
    api: Api;
    account: Account;
    boot: Boot;
    app: AppEvents;
  }
}
