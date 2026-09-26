// @vitest-environment jsdom
import type { GiftIdea } from "@leapsake/schema";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGiftCaptureForm } from "../src/headless/index.js";

afterEach(cleanup);

const mary = { type: "person" as const, id: "p-mary", label: "Mary Bailey" };
const george = {
  type: "person" as const,
  id: "p-george",
  label: "George Bailey",
};
const pool = [{ id: "i-kite", title: "Kite" }] as GiftIdea[];

describe("useGiftCaptureForm", () => {
  it("cannot submit without a name", () => {
    const { result } = renderHook(() => useGiftCaptureForm({ ideaPool: [] }));

    expect(result.current.errors).toEqual({ title: "required" });
    expect(result.current.submit()).toBeNull();
  });

  it("points at an existing idea, and gives each recipient their own tick", () => {
    const { result } = renderHook(() => useGiftCaptureForm({ ideaPool: pool }));

    act(() => result.current.set("title", "kite"));
    act(() => result.current.addRecipient(mary));
    act(() => result.current.addRecipient(george));
    act(() => result.current.setRecipientGiven("person:p-george", true));
    act(() => result.current.removeRecipient("person:p-mary"));

    expect([...result.current.chosen]).toEqual(["person:p-george"]);
    expect(result.current.submit()).toEqual({
      ok: true,
      input: {
        giftIdea: { id: "i-kite" },
        recipients: [
          { party: { type: "person", id: "p-george" }, given: true },
        ],
      },
    });
  });

  it("writes a fixed recipient with the one tick, starting as asked", () => {
    const { result } = renderHook(() =>
      useGiftCaptureForm({
        ideaPool: [],
        fixedRecipient: mary,
        startGiven: true,
      }),
    );

    act(() => result.current.set("title", "Socks"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: {
        giftIdea: { title: "Socks" },
        recipients: [{ party: { type: "person", id: "p-mary" }, given: true }],
      },
    });
  });

  it("resets to where it started", () => {
    const { result } = renderHook(() =>
      useGiftCaptureForm({ ideaPool: [], startGiven: true }),
    );

    act(() => result.current.set("title", "Socks"));
    act(() => result.current.addRecipient(mary));
    act(() => result.current.reset());
    expect(result.current.fields).toEqual({
      title: "",
      url: "",
      given: true,
      recipients: [],
    });
  });
});
