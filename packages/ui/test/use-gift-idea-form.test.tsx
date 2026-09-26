// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGiftIdeaForm } from "../src/headless/index.js";

afterEach(cleanup);

describe("useGiftIdeaForm", () => {
  it("starts blank on create, and cannot submit without a title", () => {
    const { result } = renderHook(() => useGiftIdeaForm());

    expect(result.current.fields).toEqual({
      title: "",
      url: "",
      notes: "",
      tags: "",
    });
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.errors).toEqual({ title: "required" });
    expect(result.current.submit()).toBeNull();
  });

  it("starts from the idea being edited", () => {
    const { result } = renderHook(() =>
      useGiftIdeaForm({ title: "Kite", url: null, notes: "big" }, "#toys"),
    );

    expect(result.current.fields).toEqual({
      title: "Kite",
      url: "",
      notes: "big",
      tags: "#toys",
    });
    expect(result.current.canSubmit).toBe(true);
  });

  it("submits the shaped input once a title is typed", () => {
    const { result } = renderHook(() => useGiftIdeaForm());

    act(() => result.current.set("title", "  Tom Sawyer "));
    act(() => result.current.set("tags", "#books"));

    expect(result.current.errors).toEqual({});
    expect(result.current.submit()).toEqual({
      ok: true,
      input: { title: "Tom Sawyer", url: null, notes: null },
      tags: ["books"],
    });
  });
});
