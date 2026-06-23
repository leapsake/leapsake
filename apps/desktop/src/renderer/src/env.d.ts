import type { Api, Boot, Sync } from "../../preload";

declare global {
  interface Window {
    api: Api;
    sync: Sync;
    boot: Boot;
  }
}
