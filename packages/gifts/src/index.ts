/**
 * `@leapsake/gifts` — gift ideas, and who each one is for.
 *
 * Two tables and one join: an **idea** (a title and an optional url, taggable
 * like any other entity) and a **recipient link** pairing that idea with a
 * person or a pet, carrying whether it has actually been given. "Given" is a
 * column on the link rather than a dated row of its own — the scope cut of
 * 2026-08; what was removed is recorded in `plans/v0-2.md`.
 *
 * Repo ports arrive injected from `@leapsake/data`; nothing here opens a driver
 * of its own or depends on `@leapsake/core`.
 */
export { createGiftsApi } from "./api.js";
export type {
  GiftForIdea,
  GiftForRecipient,
  GiftIdeaOverview,
  GiftsApiDeps,
} from "./api.js";
