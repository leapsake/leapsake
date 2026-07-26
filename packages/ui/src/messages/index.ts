/**
 * `@leapsake/ui/messages` — the text every component renders, and the seam that
 * supplies it.
 *
 * Platform-neutral (a type, a plain object, and a React context), so a native
 * renderer would share the same catalog. See `types.ts` for the rules the
 * catalog follows — chiefly that a message taking values is a **function**, so
 * the catalog owns whole sentences and components only supply data.
 */
export { MessagesProvider, useMessages } from "./context.js";
export { en } from "./en.js";
export type { Messages } from "./types.js";
