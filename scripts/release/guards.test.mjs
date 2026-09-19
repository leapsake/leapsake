import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { confirmTag, laptopUploadRefusal, via } from "./guards.mjs";

const typed = (text) => ({
  input: Readable.from([text]),
  output: new PassThrough(),
});

describe("confirmTag", () => {
  it("accepts the exact tag", async () => {
    await expect(
      confirmTag("v0.1.0-beta.10", typed("v0.1.0-beta.10\n")),
    ).resolves.toBe(true);
  });

  it("aborts on anything else", async () => {
    for (const answer of ["y\n", "yes\n", "v0.1.0-beta.1\n", "\n"]) {
      await expect(confirmTag("v0.1.0-beta.10", typed(answer))).resolves.toBe(
        false,
      );
    }
  });

  it("aborts when the input ends unanswered", async () => {
    await expect(confirmTag("v0.1.0-beta.10", typed(""))).resolves.toBe(false);
  });
});

const guard = (over = {}) =>
  laptopUploadRefusal({
    tag: "v0.1.0-beta.10",
    here: true,
    ci: false,
    remoteHasTag: () => true,
    confirm: async () => true,
    ...over,
  });

describe("laptopUploadRefusal", () => {
  it("refuses without --here, in one line", async () => {
    const reason = await guard({ here: false });
    expect(reason).toMatch(/without --here/);
    expect(reason).not.toMatch(/\n/);
  });

  it("refuses a tag origin cannot see, before asking", async () => {
    let asked = false;
    const reason = await guard({
      remoteHasTag: () => false,
      confirm: async () => (asked = true),
    });
    expect(reason).toMatch(/origin does not have v0\.1\.0-beta\.10/);
    expect(asked).toBe(false);
  });

  it("refuses when the tag is not typed back", async () => {
    expect(await guard({ confirm: async () => false })).toMatch(/not typed/);
  });

  it("allows a confirmed upload of a pushed tag", async () => {
    expect(await guard()).toBeUndefined();
  });

  it("asks nothing on a runner", async () => {
    expect(
      await guard({ ci: true, here: false, remoteHasTag: () => false }),
    ).toBeUndefined();
  });
});

describe("via", () => {
  it("says ci only when CI=true", () => {
    expect(via({ CI: "true" })).toBe("ci");
    expect(via({ CI: "1" })).toBe("laptop");
    expect(via({})).toBe("laptop");
  });
});
