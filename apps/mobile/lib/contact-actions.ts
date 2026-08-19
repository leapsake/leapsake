import type { LinkAction } from "@leapsake/contact-links";

/**
 * The device half of tapping a contact method.
 *
 * `@leapsake/contact-links` answers what a contact method *could* do — it is
 * pure, and deliberately knows nothing about this phone. What is left is the
 * part that depends on the handset: whether a scheme resolves to an installed
 * app, and what to open when it doesn't.
 *
 * It stays pure anyway, in the same way `device-contacts.ts` does: the native
 * calls (`Linking.canOpenURL`, `Linking.openURL`, `Clipboard`) live in the
 * component, and everything decided *from* their answers lives here where a node
 * test can hold it still. The bridge is a set of schemes the device is known to
 * support, probed once rather than per row — there are only ever two of them
 * (`NATIVE_SCHEMES`), while a person can have a dozen contact methods.
 */

/** The scheme of a URL — `facetime:+15550109999` → `facetime`. */
export function schemeOf(url: string): string {
  const colon = url.indexOf(":");
  return colon === -1 ? "" : url.slice(0, colon).toLowerCase();
}

/**
 * Whether this device can open an action's preferred URL. Anything that is not a
 * declared custom scheme (https, mailto, tel, sms) is taken as openable without
 * asking: those are handled by the OS itself, and `canOpenURL` on iOS answers for
 * *declared* schemes only, so probing them would be asking a question whose
 * answer we would then have to ignore.
 */
function canOpenDirectly(
  action: LinkAction,
  supportedSchemes: ReadonlySet<string>,
): boolean {
  return !action.native || supportedSchemes.has(schemeOf(action.url));
}

/**
 * The URL a tap should actually open, or `null` when the action has no route to
 * an app and should fall back to the clipboard.
 *
 * This is the fallback chain in one expression: the custom scheme when the app
 * that answers it is installed, the https URL when it isn't, and nothing when
 * neither exists. An https URL always wins by default rather than by probe — an
 * installed app intercepts its own universal links, and a browser handles the
 * rest, so there is no case where it fails to open *something*.
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
 * The actions worth showing on this device, in the order they were resolved.
 *
 * Drops only what would visibly do nothing: a custom-scheme action with no https
 * fallback whose scheme this device cannot open — FaceTime on Android, and
 * `geo:` on iOS if the maps action ever loses its web URL. Everything else stays,
 * because a link that opens a browser instead of an app is still the user
 * reaching the person, which is the point.
 *
 * A `copy` action is always kept: it is the reason no row can dead-end.
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

/**
 * What tapping the row itself does — the first surviving action.
 *
 * Undefined only when a method offers nothing at all (an email row whose address
 * is blank), in which case the row is not tappable rather than tappable and
 * inert.
 */
export function primaryAction(
  actions: readonly LinkAction[],
  supportedSchemes: ReadonlySet<string>,
): LinkAction | undefined {
  return offeredActions(actions, supportedSchemes)[0];
}
