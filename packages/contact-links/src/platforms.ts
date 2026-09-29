import type { Platform } from "./types.js";
import { bareHandle, encode } from "./normalize.js";

/** The first-class platforms, in picker order, all https; the three shapes
 *  are in the README's _How close a link gets you_. */
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
    // The username is also the `m.me` slug: chat first, then profile.
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
    // `ig.me/m/` opens a DM; the profile covers an unmessageable account.
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
    // A Discord username addresses nothing; the row falls back to copying it.
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

/** The registry entry for an id, or `undefined` for an unknown platform. */
export function findPlatform(id: string): Platform | undefined {
  return BY_ID.get(id);
}

/** The platforms a phone number can reach: the phone form's opt-ins. */
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

/** Every custom scheme Leapsake emits that iOS needs declared; mobile pins it
 *  with a test. */
export const NATIVE_SCHEMES: readonly string[] = ["facetime", "geo"];

/** A throwaway URL per {@link NATIVE_SCHEMES} entry, only ever probed. */
export const SCHEME_PROBES: Readonly<Record<string, string>> = {
  facetime: "facetime:0000000000",
  geo: "geo:0,0",
};
