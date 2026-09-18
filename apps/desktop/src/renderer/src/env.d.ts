import type { FlagName } from "@leapsake/flags";
import type { Api, AppEvents, Boot, Sync } from "../../preload";

declare global {
  interface Window {
    api: Api;
    sync: Sync;
    boot: Boot;
    app: AppEvents;
    /** This launch's flags, resolved in the main process. Read through
     *  `flag()` after `main.tsx` seeds the renderer's own module with them. */
    flags: Record<FlagName, boolean>;
  }
}
