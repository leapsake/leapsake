import { formatPostalAddress } from "@leapsake/schema";
import type { LinkAction, Platform, PlatformLink } from "./types.js";
import { findPlatform, PHONE_PLATFORMS } from "./platforms.js";
import { encode, phoneDigits, phoneE164 } from "./normalize.js";

/**
 * The shape {@link resolveActions} reads, kept structural rather than importing
 * `@leapsake/schema`'s `ContactMethod` union.
 *
 * The real rows satisfy this by construction — every field below is a field they
 * already have — but depending on the *shape* instead of the *type* keeps this
 * package narrow: it can be handed a staged, not-yet-saved contact method from
 * the create-person flow, or a projection that never touched the database, and
 * it neither knows nor cares. (Only `formatPostalAddress` is borrowed from
 * schema, because a second address formatter would be a second answer to a
 * question that already has one.)
 */
export type ContactMethodLike =
  | { kind: "email"; method: { address: string } }
  | {
      kind: "phone";
      method: {
        number: string;
        smsCapable?: boolean;
        /** Platform ids the user has confirmed this number reaches. */
        reachableOn?: readonly string[] | null;
      };
    }
  | {
      kind: "postal";
      method: {
        line1: string;
        line2: string | null;
        locality: string | null;
        region: string | null;
        postalCode: string | null;
        country: string | null;
      };
    }
  | {
      kind: "social";
      method: {
        platform: string;
        handle: string;
        platformUserId?: string | null;
        url?: string | null;
      };
    };

/** Turn a platform's candidate into an action, resolving the fallback pair. */
function toAction(
  id: string,
  platform: Platform,
  link: PlatformLink,
): LinkAction {
  return {
    id,
    verb: link.reach === "chat" ? "chat" : "open",
    platformId: platform.id,
    name: platform.name,
    url: link.url ?? link.web,
    webUrl: link.url === undefined ? undefined : link.web,
    native: link.url !== undefined,
    reach: link.reach,
    confirm: false,
  };
}

/** The always-last action, so no row can ever dead-end with nothing to do. */
function copyAction(id: string, text: string): LinkAction {
  return {
    id,
    verb: "copy",
    url: "",
    native: false,
    reach: null,
    confirm: false,
    copyText: text,
  };
}

/**
 * Everything the user could do with one contact method, best first.
 *
 * `[0]` is what tapping the row does; the rest fill the overflow sheet. The
 * ordering rules live here rather than in a component so they are testable and
 * so desktop and mobile cannot drift: a number the user has marked as not
 * textable leads with Call rather than offering a text that goes nowhere, a
 * chat link always outranks the profile link for the same platform, and `copy`
 * closes every list.
 *
 * Nothing here knows whether an app is installed — that is a device question the
 * caller answers by probing `url` and falling back to `webUrl`.
 */
export function resolveActions(entry: ContactMethodLike): LinkAction[] {
  if (entry.kind === "email") {
    const address = entry.method.address.trim();
    if (address === "") return [];
    return [
      {
        id: "email.compose",
        verb: "email",
        // Left unencoded: `mailto:` takes the address verbatim, and percent-
        // encoding the `@` trips up more clients than it protects against.
        url: `mailto:${address}`,
        native: false,
        reach: null,
        confirm: false,
      },
      copyAction("email.copy", address),
    ];
  }

  if (entry.kind === "phone") {
    const { number, smsCapable = true, reachableOn } = entry.method;
    const e164 = phoneE164(number);
    const digits = phoneDigits(number);
    if (digits === "") return [copyAction("phone.copy", number.trim())];

    const actions: LinkAction[] = [];
    // A landline or fax offers no text at all — a dead action is worse than a
    // missing one — which also promotes Call to the row-tap primary.
    if (smsCapable) {
      actions.push({
        id: "phone.text",
        verb: "text",
        url: `sms:${e164}`,
        native: false,
        reach: "chat",
        confirm: false,
      });
    }
    actions.push(
      {
        id: "phone.call",
        verb: "call",
        url: `tel:${e164}`,
        native: false,
        reach: null,
        // Placing a call is disruptive and cannot be taken back, so it is the
        // one action that asks first.
        confirm: true,
      },
      {
        id: "phone.facetime",
        verb: "video",
        url: `facetime:${e164}`,
        native: true,
        reach: "chat",
        confirm: false,
      },
    );

    // Opt-in only: Leapsake cannot tell whether a number is on WhatsApp, so the
    // user says so on the phone form and the action appears from then on.
    const confirmed = new Set(reachableOn ?? []);
    for (const platform of PHONE_PLATFORMS) {
      if (!confirmed.has(platform.id)) continue;
      for (const link of platform.fromPhone?.({ digits, e164 }) ?? []) {
        actions.push(toAction(`phone.${platform.id}`, platform, link));
      }
    }

    actions.push(copyAction("phone.copy", number.trim()));
    return actions;
  }

  if (entry.kind === "postal") {
    const formatted = formatPostalAddress(entry.method);
    return [
      {
        id: "postal.map",
        verb: "map",
        // `geo:` is the Android intent; iOS has no handler for it and falls
        // through to the universal maps URL, which opens the maps app there.
        url: `geo:0,0?q=${encode(formatted)}`,
        webUrl: `https://www.google.com/maps/search/?api=1&query=${encode(formatted)}`,
        native: true,
        reach: null,
        confirm: false,
      },
      copyAction("postal.copy", formatted),
    ];
  }

  const { platform: platformId, handle, platformUserId, url } = entry.method;
  const platform = findPlatform(platformId);
  const actions: LinkAction[] = [];

  if (platform) {
    // The opaque id, where the user supplied one, reaches further than the
    // handle does — that is the only reason the field exists — so it leads.
    const userId = platformUserId?.trim();
    if (userId) {
      for (const link of platform.fromUserId?.(userId) ?? []) {
        actions.push(toAction(`social.${platform.id}.id`, platform, link));
      }
    }
    const bare = handle.trim();
    if (bare !== "") {
      for (const link of platform.fromHandle?.(bare) ?? []) {
        actions.push(
          toAction(`social.${platform.id}.${link.reach}`, platform, link),
        );
      }
    }
  }

  // The escape hatch: a URL the user pasted for a platform we have no template
  // for, or an extra profile link on one we do.
  const raw = url?.trim();
  if (raw) {
    actions.push({
      id: "social.url",
      verb: "open",
      platformId: platform?.id,
      name: platform?.name,
      url: raw,
      native: false,
      reach: "profile",
      confirm: false,
    });
  }

  const copyText = handle.trim() || raw || "";
  if (copyText !== "") actions.push(copyAction("social.copy", copyText));
  return actions;
}
