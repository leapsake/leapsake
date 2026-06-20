import type { Api, Sync } from "../../preload";

declare global {
  interface Window {
    api: Api;
    sync: Sync;
  }
}
