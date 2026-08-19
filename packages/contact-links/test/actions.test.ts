import { describe, expect, it } from "vitest";
import {
  type ContactMethodLike,
  type LinkAction,
  NATIVE_SCHEMES,
  PLATFORMS,
  resolveActions,
} from "../src/index.js";

/** The action ids, in the order the row would offer them. */
const ids = (actions: LinkAction[]): string[] => actions.map((a) => a.id);

/** The row-tap primary — the whole point of the ordering. */
const primary = (entry: ContactMethodLike): LinkAction | undefined =>
  resolveActions(entry)[0];

const postal = {
  line1: "12 Rue Oberkampf",
  line2: null,
  locality: "Paris",
  region: null,
  postalCode: "75011",
  country: "FR",
};

describe("email", () => {
  it("leads with a mailto and keeps the address unencoded", () => {
    const actions = resolveActions({
      kind: "email",
      method: { address: "josh@example.com" },
    });
    expect(ids(actions)).toEqual(["email.compose", "email.copy"]);
    expect(actions[0].url).toBe("mailto:josh@example.com");
    expect(actions[0].native).toBe(false);
  });

  it("offers nothing for a blank address", () => {
    expect(
      resolveActions({ kind: "email", method: { address: "  " } }),
    ).toEqual([]);
  });
});

describe("phone", () => {
  it("leads with a text when the number can receive one", () => {
    const actions = resolveActions({
      kind: "phone",
      method: { number: "+1 (555) 010-9999", smsCapable: true },
    });
    expect(ids(actions)).toEqual([
      "phone.text",
      "phone.call",
      "phone.facetime",
      "phone.copy",
    ]);
    expect(actions[0].url).toBe("sms:+15550109999");
  });

  it("omits the text entirely for a landline, promoting Call to primary", () => {
    const actions = resolveActions({
      kind: "phone",
      method: { number: "+15550109999", smsCapable: false },
    });
    expect(ids(actions)).not.toContain("phone.text");
    expect(actions[0].id).toBe("phone.call");
  });

  it("asks before calling, and only before calling", () => {
    const actions = resolveActions({
      kind: "phone",
      method: { number: "+15550109999" },
    });
    expect(actions.filter((a) => a.confirm).map((a) => a.id)).toEqual([
      "phone.call",
    ]);
  });

  it("assumes a number is textable when smsCapable is not given", () => {
    expect(
      primary({ kind: "phone", method: { number: "+15550109999" } })?.id,
    ).toBe("phone.text");
  });

  it("offers a phone platform only once the user has confirmed it", () => {
    const bare = resolveActions({
      kind: "phone",
      method: { number: "+15550109999" },
    });
    expect(ids(bare)).not.toContain("phone.whatsapp");

    const confirmed = resolveActions({
      kind: "phone",
      method: { number: "+15550109999", reachableOn: ["whatsapp"] },
    });
    expect(ids(confirmed)).toContain("phone.whatsapp");
    expect(ids(confirmed)).not.toContain("phone.signal");
  });

  it("builds wa.me from bare digits and signal.me from E.164", () => {
    const actions = resolveActions({
      kind: "phone",
      method: {
        number: "+1 (555) 010-9999",
        reachableOn: ["whatsapp", "signal"],
      },
    });
    const byId = new Map(actions.map((a) => [a.id, a.url]));
    expect(byId.get("phone.whatsapp")).toBe("https://wa.me/15550109999");
    expect(byId.get("phone.signal")).toBe("https://signal.me/#p/+15550109999");
  });

  it("falls back to copying a number that holds no digits", () => {
    const actions = resolveActions({
      kind: "phone",
      method: { number: "ask my mum" },
    });
    expect(ids(actions)).toEqual(["phone.copy"]);
    expect(actions[0].copyText).toBe("ask my mum");
  });
});

describe("postal", () => {
  it("maps the formatted address and offers a web fallback", () => {
    const actions = resolveActions({ kind: "postal", method: postal });
    expect(ids(actions)).toEqual(["postal.map", "postal.copy"]);
    expect(actions[0].native).toBe(true);
    expect(actions[0].url.startsWith("geo:0,0?q=")).toBe(true);
    expect(actions[0].webUrl).toContain("google.com/maps");
    expect(actions[1].copyText).toBe("12 Rue Oberkampf, Paris, 75011, FR");
  });
});

describe("social", () => {
  it("puts the chat link ahead of the profile link for one handle", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "facebook", handle: "joshsmith" },
    });
    expect(ids(actions)).toEqual([
      "social.facebook.chat",
      "social.facebook.profile",
      "social.copy",
    ]);
    expect(actions[0].url).toBe("https://m.me/joshsmith");
    expect(actions[0].reach).toBe("chat");
  });

  it("reports profile reach honestly where DMs are not addressable", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "tiktok", handle: "josh" },
    });
    expect(actions[0].reach).toBe("profile");
    expect(actions[0].url).toBe("https://www.tiktok.com/@josh");
  });

  it("upgrades reach from profile to chat when a user id is supplied", () => {
    const withoutId = resolveActions({
      kind: "social",
      method: { platform: "x", handle: "josh" },
    });
    expect(withoutId[0].reach).toBe("profile");

    const withId = resolveActions({
      kind: "social",
      method: { platform: "x", handle: "josh", platformUserId: "12345" },
    });
    expect(withId[0].reach).toBe("chat");
    expect(withId[0].url).toBe(
      "https://x.com/messages/compose?recipient_id=12345",
    );
    // The profile is still reachable behind it.
    expect(ids(withId)).toContain("social.x.profile");
  });

  it("degrades a Discord handle to copy, since a username addresses nothing", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "discord", handle: "josh" },
    });
    expect(ids(actions)).toEqual(["social.copy"]);
  });

  it("uses a Discord user id when there is one", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "discord", handle: "josh", platformUserId: "999" },
    });
    expect(actions[0].url).toBe("https://discord.com/users/999");
    expect(actions[0].reach).toBe("chat");
  });

  it("opens the pasted URL for a platform it has no template for", () => {
    const actions = resolveActions({
      kind: "social",
      method: {
        platform: "mastodon",
        handle: "josh@hachyderm.io",
        url: "https://hachyderm.io/@josh",
      },
    });
    expect(ids(actions)).toEqual(["social.url", "social.copy"]);
    expect(actions[0].url).toBe("https://hachyderm.io/@josh");
  });

  it("still offers copy for an unknown platform with no URL", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "mastodon", handle: "josh@hachyderm.io" },
    });
    expect(ids(actions)).toEqual(["social.copy"]);
    expect(actions[0].copyText).toBe("josh@hachyderm.io");
  });

  it("percent-encodes a handle so it cannot break out of the path", () => {
    const actions = resolveActions({
      kind: "social",
      method: { platform: "telegram", handle: "a/b?c" },
    });
    expect(actions[0].url).toBe("https://t.me/a%2Fb%3Fc");
  });
});

describe("the registry as a whole", () => {
  const everyAction: LinkAction[] = [
    ...resolveActions({ kind: "email", method: { address: "a@b.com" } }),
    ...resolveActions({
      kind: "phone",
      method: {
        number: "+15550109999",
        reachableOn: PLATFORMS.map((p) => p.id),
      },
    }),
    ...resolveActions({ kind: "postal", method: postal }),
    ...PLATFORMS.flatMap((platform) =>
      resolveActions({
        kind: "social",
        method: { platform: platform.id, handle: "josh", platformUserId: "1" },
      }),
    ),
  ];

  it("emits only parseable URLs", () => {
    for (const action of everyAction) {
      if (action.verb === "copy") continue;
      expect(() => new URL(action.url), action.id).not.toThrow();
      if (action.webUrl) {
        expect(() => new URL(action.webUrl!), action.id).not.toThrow();
      }
    }
  });

  it("declares every custom scheme it can emit", () => {
    const emitted = new Set(
      everyAction
        .filter((a) => a.native)
        .map((a) => a.url.slice(0, a.url.indexOf(":"))),
    );
    for (const scheme of emitted) {
      expect(NATIVE_SCHEMES, `${scheme} is undeclared`).toContain(scheme);
    }
  });

  it("keeps platform links on https, so the list is not baked into the binary", () => {
    for (const action of everyAction) {
      if (action.platformId === undefined) continue;
      expect(action.native, action.id).toBe(false);
      expect(action.url.startsWith("https://"), action.id).toBe(true);
    }
  });

  it("gives every platform a unique id and a phone/handle builder to match", () => {
    expect(new Set(PLATFORMS.map((p) => p.id)).size).toBe(PLATFORMS.length);
    for (const platform of PLATFORMS) {
      if (platform.key === "phone") {
        expect(platform.fromPhone, platform.id).toBeDefined();
        expect(platform.fromHandle, platform.id).toBeUndefined();
      } else {
        expect(platform.fromHandle, platform.id).toBeDefined();
        expect(platform.fromPhone, platform.id).toBeUndefined();
      }
      // The optional id field exists only where an id reaches further.
      expect(Boolean(platform.acceptsUserId), platform.id).toBe(
        platform.fromUserId !== undefined,
      );
    }
  });

  it("ends every non-empty list with copy, so no row dead-ends", () => {
    const lists = [
      resolveActions({ kind: "email", method: { address: "a@b.com" } }),
      resolveActions({ kind: "phone", method: { number: "+15550109999" } }),
      resolveActions({ kind: "postal", method: postal }),
      resolveActions({
        kind: "social",
        method: { platform: "discord", handle: "josh" },
      }),
    ];
    for (const list of lists) {
      expect(list.at(-1)?.verb).toBe("copy");
    }
  });
});
