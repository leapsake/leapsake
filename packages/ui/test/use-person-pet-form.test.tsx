// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePersonForm, usePetForm } from "../src/headless/index.js";

afterEach(cleanup);

describe("usePersonForm", () => {
  it("cannot submit until some part of the name is typed", () => {
    const { result } = renderHook(() => usePersonForm());

    expect(result.current.errors).toEqual({ name: "required" });
    expect(result.current.submit()).toBeNull();
    act(() => result.current.set("lastName", "Bailey"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: {
        firstName: null,
        middleName: null,
        lastName: "Bailey",
        gender: null,
      },
      tags: [],
    });
  });

  it("starts from the person being edited", () => {
    const { result } = renderHook(() =>
      usePersonForm(
        {
          firstName: "George",
          middleName: null,
          lastName: "Bailey",
          gender: "male",
        },
        "#family",
      ),
    );

    expect(result.current.fields).toEqual({
      firstName: "George",
      middleName: "",
      lastName: "Bailey",
      gender: "male",
      tags: "#family",
    });
    expect(result.current.canSubmit).toBe(true);
  });
});

describe("usePetForm", () => {
  it("cannot submit without a name", () => {
    const { result } = renderHook(() => usePetForm());

    expect(result.current.errors).toEqual({ name: "required" });
    act(() => result.current.set("name", "Zuzu"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: { name: "Zuzu", gender: null },
      tags: [],
    });
  });
});
