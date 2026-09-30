/** What a platform is keyed on: a stored number, adding to the phone row, or
 *  a typed handle with a row of its own. */
export type PlatformKey = "phone" | "handle";

/** How close a link gets you; see the README's _How close a link gets you_. */
export type Reach = "chat" | "profile";

/** What a tap *does*, independent of which platform is doing it. */
export type ActionVerb =
  | "text"
  | "call"
  | "video"
  | "email"
  | "map"
  | "chat"
  | "open"
  | "copy";

/** One candidate link a platform offers: `url` first if set, then `web`. */
export interface PlatformLink {
  /** A custom-scheme URL to try first, when one buys anything over `web`. */
  url?: string;
  /** The https URL. Installed apps intercept their own universal links. */
  web: string;
  reach: Reach;
}

/** A platform Leapsake knows how to open, over https; see the README. */
export interface Platform {
  /** Stable id, stored in `social_profiles.platform`. Never user-visible. */
  id: string;
  /** The proper noun, untranslated. */
  name: string;
  key: PlatformKey;
  /** Whether an opaque user id reaches further than the handle, which shows
   *  the form's optional id field. */
  acceptsUserId?: true;
  /** Reduces what was typed or pasted to the bare handle; {@link bareHandle}
   *  by default. */
  normalizeHandle?: (raw: string) => string;
  /** Ordered link candidates for a bare handle. */
  fromHandle?: (handle: string) => PlatformLink[];
  /** Ordered link candidates for the opaque id; set iff `acceptsUserId`. */
  fromUserId?: (userId: string) => PlatformLink[];
  /** Ordered link candidates for an E.164 number; `phone`-keyed platforms
   *  only. */
  fromPhone?: (e164: string) => PlatformLink[];
}

/** One thing the user can do with a contact method, if the device can. */
export interface LinkAction {
  /** Stable identity, e.g. `phone.whatsapp` or `social.instagram.profile`. */
  id: string;
  verb: ActionVerb;
  /** Set when the action belongs to a registry platform. */
  platformId?: string;
  /** The platform's proper noun, for the message catalog to interpolate. */
  name?: string;
  /** Tried first. A custom scheme when `native`, otherwise the https URL. */
  url: string;
  /** The https fallback, when `url` is a scheme that may not resolve. */
  webUrl?: string;
  /** Whether `url` is a custom scheme, needing a probe; see
   *  {@link NATIVE_SCHEMES}. */
  native: boolean;
  /** Where the link lands, or `null` for actions that open no conversation. */
  reach: Reach | null;
  /** Ask before acting, as `call` does. */
  confirm: boolean;
  /** The text a `copy` action puts on the clipboard. Set only on `copy`. */
  copyText?: string;
}
