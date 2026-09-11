import { describe, expect, it } from "vitest";
import appJson from "../app.json";
import {
  type LinkAction,
  NATIVE_SCHEMES,
  PLATFORMS,
  resolveActions,
} from "@leapsake/contact-links";
import {
  offeredActions,
  primaryAction,
  schemeOf,
  targetUrl,
} from "./contact-actions";

/** Both schemes resolve — an iPhone with everything installed. */
const ALL = new Set(NATIVE_SCHEMES);
/** Nothing custom resolves — an Android handset, where `facetime:` is nobody's. */
const NONE = new Set<string>();

const action = (over: Partial<LinkAction> = {}): LinkAction => ({
  id: "test",
  verb: "open",
  url: "https://example.com",
  native: false,
  reach: "profile",
  confirm: false,
  ...over,
});

describe("schemeOf", () => {
  it("reads the scheme off a URL", () => {
    expect(schemeOf("facetime:+15550109999")).toBe("facetime");
    expect(schemeOf("https://example.com")).toBe("https");
    expect(schemeOf("geo:0,0?q=x")).toBe("geo");
  });

  it("is empty for something that is not a URL", () => {
    expect(schemeOf("just text")).toBe("");
  });
});

describe("targetUrl", () => {
  it("never probes a plain https link", () => {
    expect(targetUrl(action(), NONE)).toBe("https://example.com");
  });

  it("prefers the custom scheme when the device can open it", () => {
    const geo = action({
      url: "geo:0,0?q=Paris",
      webUrl: "https://maps.example/Paris",
      native: true,
    });
    expect(targetUrl(geo, ALL)).toBe("geo:0,0?q=Paris");
  });

  it("falls back to the web URL when it cannot", () => {
    const geo = action({
      url: "geo:0,0?q=Paris",
      webUrl: "https://maps.example/Paris",
      native: true,
    });
    expect(targetUrl(geo, NONE)).toBe("https://maps.example/Paris");
  });

  it("has nowhere to go for an unsupported scheme with no fallback", () => {
    const facetime = action({ url: "facetime:+1555", native: true });
    expect(targetUrl(facetime, NONE)).toBeNull();
  });

  it("sends a copy action nowhere — it is not a link", () => {
    expect(targetUrl(action({ verb: "copy", url: "" }), ALL)).toBeNull();
  });
});

describe("offeredActions", () => {
  const phone = resolveActions({
    kind: "phone",
    method: { number: "+15550109999", reachableOn: ["whatsapp"] },
  });

  it("keeps everything on a device that opens every scheme", () => {
    expect(offeredActions(phone, ALL).map((a) => a.id)).toEqual([
      "phone.text",
      "phone.call",
      "phone.facetime",
      "phone.whatsapp",
      "phone.copy",
    ]);
  });

  it("drops FaceTime where nothing answers the scheme", () => {
    const ids = offeredActions(phone, NONE).map((a) => a.id);
    expect(ids).not.toContain("phone.facetime");
    // …and leaves everything reachable another way alone.
    expect(ids).toEqual([
      "phone.text",
      "phone.call",
      "phone.whatsapp",
      "phone.copy",
    ]);
  });

  it("keeps the map action on both, because it carries a web fallback", () => {
    const postal = resolveActions({
      kind: "postal",
      method: {
        line1: "12 Rue Oberkampf",
        line2: null,
        locality: "Paris",
        region: null,
        postalCode: "75011",
        country: "FR",
      },
    });
    for (const device of [ALL, NONE]) {
      expect(offeredActions(postal, device).map((a) => a.id)).toContain(
        "postal.map",
      );
    }
  });

  it("always keeps copy, so no row can dead-end", () => {
    const discord = resolveActions({
      kind: "social",
      method: { platform: "discord", handle: "george" },
    });
    expect(offeredActions(discord, NONE).map((a) => a.id)).toEqual([
      "social.copy",
    ]);
  });
});

describe("primaryAction", () => {
  it("is what the row tap does", () => {
    const email = resolveActions({
      kind: "email",
      method: { address: "george@example.com" },
    });
    expect(primaryAction(email, ALL)?.id).toBe("email.compose");
  });

  it("is undefined when a method offers nothing at all", () => {
    expect(primaryAction([], ALL)).toBeUndefined();
  });
});

/**
 * The iOS trap, held shut by a test rather than by anyone remembering.
 *
 * `Linking.canOpenURL` returns false — with no error, no warning, nothing in the
 * log — for any scheme missing from `LSApplicationQueriesSchemes`. So the set of
 * schemes the app can even *ask* about is a property of the built binary, and
 * the only way that stays in step with the registry is if a build fails when it
 * doesn't.
 */
describe("app.json declares what the registry can emit", () => {
  it("declares every scheme in NATIVE_SCHEMES", () => {
    const declared = new Set<string>(
      appJson.expo.ios.infoPlist.LSApplicationQueriesSchemes,
    );
    for (const scheme of NATIVE_SCHEMES) {
      expect(declared, `${scheme} is not declared in app.json`).toContain(
        scheme,
      );
    }
  });

  it("emits no custom scheme that NATIVE_SCHEMES leaves out", () => {
    const everyAction = [
      ...resolveActions({ kind: "email", method: { address: "a@b.com" } }),
      ...resolveActions({
        kind: "phone",
        method: {
          number: "+15550109999",
          reachableOn: PLATFORMS.map((p) => p.id),
        },
      }),
      ...resolveActions({
        kind: "postal",
        method: {
          line1: "1 Test St",
          line2: null,
          locality: null,
          region: null,
          postalCode: null,
          country: null,
        },
      }),
      ...PLATFORMS.flatMap((platform) =>
        resolveActions({
          kind: "social",
          method: {
            platform: platform.id,
            handle: "george",
            platformUserId: "1",
          },
        }),
      ),
    ];
    for (const native of everyAction.filter((a) => a.native)) {
      expect(NATIVE_SCHEMES, native.id).toContain(schemeOf(native.url));
    }
  });
});
