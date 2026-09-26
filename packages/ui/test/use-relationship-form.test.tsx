// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRelationshipForm } from "../src/headless/index.js";

afterEach(cleanup);

const mary = { type: "person" as const, id: "p-mary", label: "Mary Hatch" };
const jimmy = { type: "pet" as const, id: "a-jimmy", label: "Jimmy" };

describe("useRelationshipForm", () => {
  it("offers every role for the subject, and narrows who once one is picked", () => {
    const { result } = renderHook(() =>
      useRelationshipForm({ subjectType: "person", candidates: [mary, jimmy] }),
    );

    const roles = result.current.roleOptions.map((r) => r.role);
    expect(roles).toContain("friend");
    expect(roles).toContain("pet");
    expect(result.current.otherTypes).toEqual(["person", "pet"]);
    act(() => result.current.setRole("pet"));
    expect(result.current.otherTypes).toEqual(["pet"]);
  });

  it("submits once a typed name resolves and a role is picked", () => {
    const { result } = renderHook(() =>
      useRelationshipForm({ subjectType: "person", candidates: [mary, jimmy] }),
    );

    expect(result.current.errors).toEqual({
      other: "required",
      role: "required",
    });
    act(() => result.current.set("other", { kind: "typed", text: "Jimmy" }));
    act(() => result.current.setRole("pet"));
    expect(result.current.submit()).toEqual({
      ok: true,
      input: {
        other: "existing",
        otherType: "pet",
        otherId: "a-jimmy",
        otherRole: "pet",
        otherRoleNote: null,
      },
    });
  });

  it("offers only the roles a fixed other end can hold", () => {
    const { result } = renderHook(() =>
      useRelationshipForm({
        subjectType: "person",
        otherFixed: true,
        initial: {
          other: { kind: "existing", ...mary },
          role: "friend",
          note: "",
        },
      }),
    );

    expect(result.current.roleOptions.map((r) => r.role)).not.toContain("pet");
    expect(result.current.canSubmit).toBe(true);
  });
});
