import type { Api, AppEvents, Boot, Sync } from "../../preload";

declare global {
  interface Window {
    api: Api;
    sync: Sync;
    boot: Boot;
    app: AppEvents;
  }
}
