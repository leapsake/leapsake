import { type LinkAction, findPlatform } from "@leapsake/contact-links";
import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";

// The device half of tapping a contact method, kept pure: the component
// probes the schemes once and makes the native calls.

/** The scheme of a URL — `facetime:+15550109999` → `facetime`. */
export function schemeOf(url: string): string {
  const colon = url.indexOf(":");
  return colon === -1 ? "" : url.slice(0, colon).toLowerCase();
}

/**
 * Only custom schemes are probed: iOS's `canOpenURL` answers for declared
 * schemes only, and the OS itself handles https, mailto, tel and sms.
 */
function canOpenDirectly(
  action: LinkAction,
  supportedSchemes: ReadonlySet<string>,
): boolean {
  return !action.native || supportedSchemes.has(schemeOf(action.url));
}

/**
 * The custom scheme if its app is installed, else the https URL, else `null`
 * for the clipboard. An https URL always opens something, so it is not probed.
 */
export function targetUrl(
  action: LinkAction,
  supportedSchemes: ReadonlySet<string>,
): string | null {
  if (action.verb === "copy") return null;
  if (canOpenDirectly(action, supportedSchemes)) return action.url;
  return action.webUrl ?? null;
}

/**
 * Drops only an action that would do nothing here, such as FaceTime on
 * Android. `copy` is always kept, so no row can dead-end.
 */
export function offeredActions(
  actions: readonly LinkAction[],
  supportedSchemes: ReadonlySet<string>,
): LinkAction[] {
  return actions.filter(
    (action) =>
      action.verb === "copy" || targetUrl(action, supportedSchemes) !== null,
  );
}

/** The first surviving action; undefined makes the row untappable. */
export function primaryAction(
  actions: readonly LinkAction[],
  supportedSchemes: ReadonlySet<string>,
): LinkAction | undefined {
  return offeredActions(actions, supportedSchemes)[0];
}

/** A glyph per verb, shared by a row's buttons and the sheet's bullets. */
export const VERB_ICON: Record<LinkAction["verb"], string> = {
  text: "💬",
  call: "📞",
  video: "🎥",
  email: "✉️",
  map: "🗺️",
  chat: "💬",
  open: "↗️",
  copy: "📋",
};

/** What each verb is called, naming the platform where it has one. */
export function actionLabel(action: LinkAction): string {
  switch (action.verb) {
    case "text":
      return "Text";
    case "call":
      return "Call";
    case "video":
      return "FaceTime";
    case "email":
      return "Send email";
    case "map":
      return "Open in Maps";
    case "copy":
      return "Copy";
    case "chat":
      return action.name === undefined
        ? "Send a message"
        : `Message on ${action.name}`;
    case "open":
      return action.name === undefined ? "Open link" : `Open in ${action.name}`;
  }
}

/**
 * The actions that get a button, in the resolver's order. Copy and any
 * repeat of a glyph already shown are left to the `⋯` sheet.
 */
export function buttonActions(actions: readonly LinkAction[]): LinkAction[] {
  const taken = new Set<string>();
  return actions.filter((action) => {
    if (action.verb === "copy") return false;
    const glyph = VERB_ICON[action.verb];
    if (taken.has(glyph)) return false;
    taken.add(glyph);
    return true;
  });
}

/** The one-line value shown under each method's label. */
export function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const ext = entry.method.extension ? ` ext. ${entry.method.extension}` : "";
    const noSms = entry.method.smsCapable ? "" : " (no texts)";
    return entry.method.number + ext + noSms;
  }
  if (entry.kind === "social") {
    // Names the platform beside the handle; an unknown platform id is shown
    // as stored, not hidden.
    const { platform, handle, url } = entry.method;
    const name = findPlatform(platform)?.name ?? platform;
    return handle === "" ? (url ?? name) : `${name} · ${handle}`;
  }
  return formatPostalAddress(entry.method);
}
