import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreApi } from "@leapsake/core";

const expoContactsDir = dirname(
  createRequire(import.meta.url).resolve("expo-contacts/package.json"),
);

/** The field keys each platform's native `ContactField` enum can decode. */
function nativeFieldKeys(os: "android" | "ios"): Set<string> {
  const [file, pattern] =
    os === "android"
      ? [
          "android/src/main/java/expo/modules/contacts/next/records/fields/ContactField.kt",
          /^\s*[A-Z_]+\("(\w+)"\)/gm,
        ]
      : [
          "ios/next/records/fields/ContactField.swift",
          /^\s*case [A-Z_]+ = "(\w+)"/gm,
        ];
  const source = readFileSync(join(expoContactsDir, file), "utf8");
  return new Set([...source.matchAll(pattern)].map(([, key]) => key));
}

const platform = vi.hoisted(() => ({ OS: "ios" }));
const getAllDetails = vi.hoisted(() =>
  vi.fn(async (_fields: string[]) => [{ id: "george-bailey" }]),
);

vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-contacts", async () => {
  // The enums are plain TypeScript; everything else in the package is native.
  const props = await import(
    /* @vite-ignore */ join(expoContactsDir, "src/types/Contact.props.ts")
  );
  return {
    ContactField: props.ContactField,
    ContactsSortOrder: props.ContactsSortOrder,
    Contact: { getAllDetails },
    getPermissionsAsync: async () => ({ granted: true }),
  };
});

const core = {
  deviceContacts: {
    getSyncEnabled: async () => true,
    linkedIds: async () => [],
  },
  import: {
    commit: async () => ({ created: 1, skipped: 0, errors: [] }),
  },
} as unknown as CoreApi;

describe("syncDeviceContacts", () => {
  beforeEach(() => {
    vi.resetModules();
    getAllDetails.mockClear();
  });

  it.each(["android", "ios"] as const)(
    "asks %s only for fields its native module can decode",
    async (os) => {
      platform.OS = os;
      const { syncDeviceContacts } = await import("./device-contacts-sync");
      await syncDeviceContacts(core);

      const requested = getAllDetails.mock.calls.flatMap(([fields]) => fields);
      expect(requested).toContain("dates");
      const decodable = nativeFieldKeys(os);
      expect(decodable.size).toBeGreaterThan(20);
      expect(requested.filter((key) => !decodable.has(key))).toEqual([]);
    },
  );
});
