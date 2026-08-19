/**
 * What a platform is keyed on — the one fact that decides where its actions can
 * come from.
 *
 * A `phone` platform (WhatsApp, Signal) reaches someone through a number the
 * user has already stored, so it surfaces as an extra action on the *phone row*
 * and never needs a row of its own. A `handle` platform needs something the user
 * types: an @name, a profile slug, an opaque id.
 */
export type PlatformKey = "phone" | "handle";

/**
 * How close a link actually gets you, and the design's central piece of honesty.
 *
 * Only a minority of platforms publish a URL that opens a *conversation*:
 * WhatsApp and Signal key on a phone number, Telegram and Messenger on a public
 * username, and Instagram exposes `ig.me/m/…`. The rest — X, Discord, TikTok,
 * Snapchat — key their DMs on an opaque numeric user id they deliberately do not
 * publish beside the handle, so a stored handle can only land on the person's
 * profile, one tap from a DM.
 *
 * This rides on every action so the UI can say where a tap goes instead of
 * promising a DM it cannot deliver.
 */
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

/**
 * One candidate link a platform offers, before it is turned into a
 * {@link LinkAction}. `url` is tried first and `web` is the fallback when it
 * cannot be opened; a candidate with no `url` is web-only, which is the common
 * case (see {@link Platform} on why custom schemes are the exception here).
 */
export interface PlatformLink {
  /** A custom-scheme URL to try first, when one buys anything over `web`. */
  url?: string;
  /** The https URL. Installed apps intercept their own universal links. */
  web: string;
  reach: Reach;
}

/**
 * A messaging or social platform Leapsake knows how to open.
 *
 * **https first.** Every first-class platform intercepts its own universal links
 * on both iOS and Android, so tapping `https://instagram.com/someone` opens the
 * Instagram app when it is installed and Safari when it is not. Custom schemes
 * would buy nothing here and cost a lot: on iOS every scheme must be declared in
 * `LSApplicationQueriesSchemes` at build time or `canOpenURL` silently returns
 * false, which makes the first-class list a property of the *binary* rather than
 * of this registry. Keeping platform links on https is what lets a new platform
 * be a registry entry instead of an app release. The only custom schemes
 * Leapsake emits are system verbs (`sms:`, `tel:`, `facetime:`, `geo:`), which
 * are not platforms at all — see {@link NATIVE_SCHEMES}.
 */
export interface Platform {
  /** Stable id, stored in `social_profiles.platform`. Never user-visible. */
  id: string;
  /** The proper noun, deliberately untranslated — "Instagram" is "Instagram". */
  name: string;
  key: PlatformKey;
  /**
   * True when an opaque platform user id unlocks a link the handle cannot reach
   * — the UI shows its optional id field only for these. Set on the platforms
   * whose DMs key on a numeric id (X, Discord); left off where the handle
   * already reaches a chat (Telegram) or where nothing better exists.
   */
  acceptsUserId?: true;
  /**
   * Reduce whatever the user typed or pasted — an `@name`, a full profile URL, a
   * trailing slash — to the bare handle. Defaults to {@link bareHandle}.
   */
  normalizeHandle?: (raw: string) => string;
  /** Ordered link candidates for a bare handle. `handle`-keyed platforms only. */
  fromHandle?: (handle: string) => PlatformLink[];
  /** Ordered link candidates for the opaque user id. Set iff `acceptsUserId`. */
  fromUserId?: (userId: string) => PlatformLink[];
  /** Ordered link candidates for a stored number. `phone`-keyed platforms only. */
  fromPhone?: (phone: { digits: string; e164: string }) => PlatformLink[];
}

/**
 * One thing the user can do with a contact method. `resolveActions` returns
 * these ordered, with `[0]` being the row-tap primary and the rest filling the
 * overflow sheet.
 *
 * The list is a statement of what is *possible*, not what will work: whether an
 * app is installed is a device question, answered by the client probing `url`
 * with `canOpenURL` and falling back to `webUrl`.
 */
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
  /**
   * `url` is a custom scheme, so it needs a `canOpenURL` probe and (on iOS) a
   * `LSApplicationQueriesSchemes` declaration. See {@link NATIVE_SCHEMES}.
   */
  native: boolean;
  /** Where the link lands, or `null` for actions that open no conversation. */
  reach: Reach | null;
  /** Ask before acting — set on `call`, which is disruptive and unrecoverable. */
  confirm: boolean;
  /** The text a `copy` action puts on the clipboard. Set only on `copy`. */
  copyText?: string;
}
