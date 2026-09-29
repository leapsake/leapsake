import { formatPostalAddress } from "@leapsake/schema";
import type { LinkAction, Platform, PlatformLink } from "./types.js";
import { findPlatform, PHONE_PLATFORMS } from "./platforms.js";
import { encode, phoneDigits, phoneE164 } from "./normalize.js";

/** The shape {@link resolveActions} reads, structural so an unsaved method
 *  passes too. */
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

/** Everything the user could do with one contact method, best first; see
 *  the README's _What a row offers, in order_. */
export function resolveActions(entry: ContactMethodLike): LinkAction[] {
  if (entry.kind === "email") {
    const address = entry.method.address.trim();
    if (address === "") return [];
    return [
      {
        id: "email.compose",
        verb: "email",
        // Unencoded: an encoded `@` trips up more mail clients than it helps.
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
    // A number that can't text offers none, which puts Call first.
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
        // A call is disruptive and irreversible, so it asks first.
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

    // Opt-in only: Leapsake cannot tell whether a number is on WhatsApp.
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
        // Android's `geo:`; iOS falls through to the universal maps URL.
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
    // A supplied opaque id reaches further than the handle, so it leads.
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

  // A pasted URL, for a platform with no template or as an extra link.
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
