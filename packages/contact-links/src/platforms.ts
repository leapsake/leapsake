import type { Platform } from "./types.js";
import { bareHandle, encode } from "./normalize.js";

/**
 * The first-class platforms, in the order their "add a profile" picker offers
 * them. Everything here is an https link on purpose — see {@link Platform} for
 * why custom schemes would make this list a property of the binary instead of a
 * property of this file.
 *
 * Three shapes show up, and the difference is not cosmetic:
 *
 * - **Chat from a handle** (Telegram, Facebook/Messenger, Instagram) — the
 *   platform publishes a username-keyed chat URL, so a tap opens the
 *   conversation.
 * - **Profile from a handle** (TikTok, Snapchat, Bluesky, LinkedIn, X) — the
 *   handle reaches the person, DMs key on an id we do not have.
 * - **Nothing from a handle** (Discord) — the username is not addressable at
 *   all; only the numeric user id is. Its `fromHandle` returns no links
 *   deliberately, and the row falls back to copying the handle until someone
 *   fills in the id.
 */
export const PLATFORMS: readonly Platform[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    key: "phone",
    fromPhone: ({ digits }) =>
      digits === "" ? [] : [{ web: `https://wa.me/${digits}`, reach: "chat" }],
  },
  {
    id: "signal",
    name: "Signal",
    key: "phone",
    fromPhone: ({ e164 }) =>
      e164 === ""
        ? []
        : [{ web: `https://signal.me/#p/${e164}`, reach: "chat" }],
  },
  {
    id: "telegram",
    name: "Telegram",
    key: "handle",
    fromHandle: (handle) => [
      { web: `https://t.me/${encode(handle)}`, reach: "chat" },
    ],
  },
  {
    id: "facebook",
    name: "Facebook",
    key: "handle",
    // The Facebook username is also the Messenger `m.me` slug, so one stored
    // handle yields both a conversation and a profile — chat first.
    fromHandle: (handle) => [
      { web: `https://m.me/${encode(handle)}`, reach: "chat" },
      {
        web: `https://www.facebook.com/${encode(handle)}`,
        reach: "profile",
      },
    ],
  },
  {
    id: "instagram",
    name: "Instagram",
    key: "handle",
    // `ig.me/m/<username>` is Instagram's `m.me` equivalent and opens a DM
    // thread; the profile is the fallback when that account cannot be messaged.
    fromHandle: (handle) => [
      { web: `https://ig.me/m/${encode(handle)}`, reach: "chat" },
      {
        web: `https://www.instagram.com/${encode(handle)}/`,
        reach: "profile",
      },
    ],
  },
  {
    id: "x",
    name: "X",
    key: "handle",
    acceptsUserId: true,
    fromHandle: (handle) => [
      { web: `https://x.com/${encode(handle)}`, reach: "profile" },
    ],
    fromUserId: (userId) => [
      {
        web: `https://x.com/messages/compose?recipient_id=${encode(userId)}`,
        reach: "chat",
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    key: "handle",
    acceptsUserId: true,
    // A Discord username addresses nothing — the client resolves people by
    // snowflake id and exposes no username-keyed URL. Returning no links is the
    // honest answer; `resolveActions` degrades the row to "copy the handle".
    fromHandle: () => [],
    fromUserId: (userId) => [
      {
        web: `https://discord.com/users/${encode(userId)}`,
        reach: "chat",
      },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    key: "handle",
    fromHandle: (handle) => [
      { web: `https://www.tiktok.com/@${encode(handle)}`, reach: "profile" },
    ],
  },
  {
    id: "snapchat",
    name: "Snapchat",
    key: "handle",
    fromHandle: (handle) => [
      {
        web: `https://www.snapchat.com/add/${encode(handle)}`,
        reach: "profile",
      },
    ],
  },
  {
    id: "bluesky",
    name: "Bluesky",
    key: "handle",
    fromHandle: (handle) => [
      { web: `https://bsky.app/profile/${encode(handle)}`, reach: "profile" },
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    key: "handle",
    fromHandle: (handle) => [
      {
        web: `https://www.linkedin.com/in/${encode(handle)}`,
        reach: "profile",
      },
    ],
  },
];

const BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

/** The registry entry for an id, or `undefined` for a platform we don't know. */
export function findPlatform(id: string): Platform | undefined {
  return BY_ID.get(id);
}

/**
 * The platforms a *phone number* can reach. This is what drives the opt-in
 * checkboxes on the phone form: Leapsake cannot know whether a number is on
 * WhatsApp, so the user says so once and the action appears from then on.
 * Deriving the list here rather than hardcoding it in the form is the whole
 * point of the registry — adding Telegram-by-phone later is an entry above, not
 * a schema migration and a new checkbox.
 */
export const PHONE_PLATFORMS: readonly Platform[] = PLATFORMS.filter(
  (platform) => platform.key === "phone",
);

/** The platforms that get a row of their own, i.e. everything handle-keyed. */
export const HANDLE_PLATFORMS: readonly Platform[] = PLATFORMS.filter(
  (platform) => platform.key === "handle",
);

/** Run a platform's handle normalizer, or the shared default. */
export function normalizeFor(platform: Platform | undefined, raw: string) {
  return (platform?.normalizeHandle ?? bareHandle)(raw);
}

/**
 * Every custom URL scheme Leapsake can emit — the exhaustive input to iOS's
 * `LSApplicationQueriesSchemes`, which is why it lives in production code rather
 * than being written out by hand in `app.json`. A scheme missing from that
 * declaration makes `canOpenURL` return false with no error, so the mobile app
 * pins this list with a test instead of relying on anyone remembering.
 *
 * It is deliberately short: no *platform* contributes to it (they are all https,
 * per {@link Platform}), only the system verbs a contact method implies.
 * `tel:`, `sms:` and `mailto:` are handled by iOS without declaration and are
 * excluded for that reason.
 */
export const NATIVE_SCHEMES: readonly string[] = ["facetime", "geo"];
