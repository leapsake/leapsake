// @vitest-environment jsdom
import type { ContactMethod } from "@leapsake/schema";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useContactMethodForm } from "../src/headless/index.js";

afterEach(cleanup);

describe("useContactMethodForm", () => {
  it("starts on an email, and cannot submit without an address", () => {
    const { result } = renderHook(() => useContactMethodForm());

    expect(result.current.fields.kind).toBe("email");
    expect(result.current.errors).toEqual({ address: "required" });
    expect(result.current.submit()).toBeNull();
    act(() => result.current.set("address", "george@example.test"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: { kind: "email", label: "Home", address: "george@example.test" },
    });
  });

  it("starts from the method being edited", () => {
    const entry: ContactMethod = {
      kind: "postal",
      method: {
        id: "c-1",
        ownerType: "person",
        ownerId: "p-1",
        label: "Home",
        line1: "320 Sycamore",
        line2: null,
        locality: "Bedford Falls",
        region: null,
        postalCode: null,
        country: "US",
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
      },
    };
    const { result } = renderHook(() => useContactMethodForm(entry));

    expect(result.current.fields).toMatchObject({
      kind: "postal",
      line1: "320 Sycamore",
      line2: "",
      country: "US",
    });
    expect(result.current.canSubmit).toBe(true);
  });

  it("switches kind, asking for what the new kind holds", () => {
    const { result } = renderHook(() => useContactMethodForm("email"));

    act(() => result.current.set("address", "george@example.test"));
    act(() => result.current.setKind("social", "instagram"));
    expect(result.current.fields).toMatchObject({
      kind: "social",
      platform: "instagram",
      label: "Personal",
    });
    expect(result.current.errors).toEqual({ handle: "required" });
  });
});
