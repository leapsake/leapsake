import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materializeSecrets } from "./materialize.mjs";

const b64 = (text) => Buffer.from(text).toString("base64");

describe("materializeSecrets", () => {
  let dir;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "leapsake-secrets-")), "secrets");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes each secret present and names the path variable it fills", () => {
    const lines = materializeSecrets(
      {
        LEAPSAKE_SECRET_PLAY_SERVICE_ACCOUNT_B64: b64('{"type":"service"}'),
        LEAPSAKE_SECRET_ANDROID_KEYSTORE_PASSWORD_B64: b64("hunter2"),
      },
      dir,
    );

    expect(lines).toEqual([
      `LEAPSAKE_ANDROID_KEYSTORE_PASSWORD_PATH=${join(dir, "android-upload-password")}`,
      `PLAY_SERVICE_ACCOUNT_PATH=${join(dir, "play-service-account.json")}`,
    ]);
    expect(readFileSync(join(dir, "play-service-account.json"), "utf8")).toBe(
      '{"type":"service"}',
    );
    expect(statSync(join(dir, "android-upload-password")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("round-trips binary content, and base64 wrapped across lines", () => {
    const bytes = Buffer.from([0, 255, 1, 254, 10, 13]);
    const wrapped = bytes.toString("base64").replace(/(.{4})/g, "$1\n");

    materializeSecrets({ LEAPSAKE_SECRET_ANDROID_KEYSTORE_B64: wrapped }, dir);

    expect(readFileSync(join(dir, "android-upload.jks"))).toEqual(bytes);
  });

  it("refuses, writing nothing, when any secret is not base64", () => {
    expect(() =>
      materializeSecrets(
        {
          LEAPSAKE_SECRET_ASC_KEY_B64: b64("key"),
          LEAPSAKE_SECRET_PLAY_SERVICE_ACCOUNT_B64: "{not base64}",
        },
        dir,
      ),
    ).toThrow("not base64: LEAPSAKE_SECRET_PLAY_SERVICE_ACCOUNT_B64");
    expect(() => statSync(dir)).toThrow();
  });

  it("writes nothing when no secret is set", () => {
    expect(
      materializeSecrets({ LEAPSAKE_SECRET_ASC_KEY_B64: " " }, dir),
    ).toEqual([]);
  });
});
