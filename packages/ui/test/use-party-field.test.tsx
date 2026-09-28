// @vitest-environment jsdom
import type { RelationshipNeighbor } from "@leapsake/schema";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CommittedParty,
  type NewParty,
  type PartyChoice,
  onlyPartnerOf,
  relationshipCommit,
  usePartyField,
  useRelationshipForm,
} from "../src/headless/index.js";

afterEach(cleanup);

const ruth: NewParty = {
  kind: "new",
  type: "person",
  name: "Ruth Dakin",
  label: "Ruth Dakin",
};
const mary: PartyChoice = {
  kind: "existing",
  type: "person",
  id: "p-mary",
  label: "Mary Hatch",
};
const written: CommittedParty = { id: "p-ruth", relationshipId: "r-ruth" };

function ports() {
  return {
    open: vi.fn(),
    removeRelationship: vi.fn(async () => {}),
    onFailure: vi.fn(),
  };
}

/** The field as a couple's occasion asks it: the screen owns the choice. */
function partnerField(initial: PartyChoice | null) {
  const p = ports();
  const commit = vi.fn(async () => written);
  const view = renderHook(() => {
    const [value, setValue] = useState(initial);
    const field = usePartyField({ value, onChange: setValue, commit, ...p });
    return { value, field };
  });
  return { ...view, ...p, commit };
}

/** The Name field of Add relationship, over the relationship form's draft. */
function relationshipName() {
  const p = ports();
  const commitOther = vi.fn(async () => written);
  const view = renderHook(() => {
    const form = useRelationshipForm({ subjectType: "person" });
    const field = usePartyField({
      value: form.fields.other?.kind === "typed" ? null : form.fields.other,
      onChange: (other) => form.update((draft) => ({ ...draft, other })),
      commit: relationshipCommit(form.fields, commitOther),
      ...p,
    });
    return { form, field };
  });
  return { ...view, ...p, commitOther };
}

describe("usePartyField", () => {
  it("offers Edit on a typed name, and Remove only clears it", async () => {
    const { result, removeRelationship } = partnerField(ruth);

    expect(result.current.field.canEdit).toBe(true);
    await act(() => result.current.field.remove());

    expect(result.current.value).toBeNull();
    expect(removeRelationship).not.toHaveBeenCalled();
  });

  it("writes a new name on Edit, then opens them", async () => {
    const { result, commit, open } = partnerField(ruth);

    await act(() => result.current.field.edit());

    expect(commit).toHaveBeenCalledWith(ruth);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ type: "person", id: "p-ruth" }),
    );
    expect(result.current.value).toMatchObject({
      kind: "existing",
      id: "p-ruth",
      label: "Ruth Dakin",
    });
  });

  it("deletes someone Edit wrote when they are removed", async () => {
    const { result, removeRelationship } = partnerField(ruth);

    await act(() => result.current.field.edit());
    await act(() => result.current.field.remove());

    expect(removeRelationship).toHaveBeenCalledWith("r-ruth");
    expect(result.current.value).toBeNull();
  });

  it("only lets go of someone it did not write", async () => {
    const { result, commit, open, removeRelationship } = partnerField({
      ...mary,
      relationshipId: "r-mary",
    });

    await act(() => result.current.field.edit());
    expect(commit).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-mary" }),
    );
    await act(() => result.current.field.remove());

    expect(removeRelationship).not.toHaveBeenCalled();
    expect(result.current.value).toBeNull();
  });

  it("reports a failed write and keeps the choice", async () => {
    const { result, commit, onFailure } = partnerField(ruth);
    const failure = new Error("disk full");
    commit.mockRejectedValueOnce(failure);

    await act(() => result.current.field.edit());

    expect(onFailure).toHaveBeenCalledWith("edit", failure);
    expect(result.current.value).toEqual(ruth);
    expect(result.current.field.busy).toBe(false);
  });
});

describe("usePartyField on a relationship's other end", () => {
  it("offers Edit on a new name only once a role is picked", () => {
    const { result } = relationshipName();

    act(() => result.current.form.update((d) => ({ ...d, other: ruth })));
    expect(result.current.field.canEdit).toBe(false);

    act(() => result.current.form.setRole("other"));
    expect(result.current.field.canEdit).toBe(false);
    act(() => result.current.form.set("note", "landlord"));
    expect(result.current.field.canEdit).toBe(true);

    act(() => result.current.form.setRole("friend"));
    expect(result.current.field.canEdit).toBe(true);
  });

  it("saves after Edit as a revision of the relationship Edit wrote", async () => {
    const { result, commitOther } = relationshipName();
    act(() => result.current.form.update((d) => ({ ...d, other: ruth })));
    act(() => result.current.form.setRole("friend"));

    await act(() => result.current.field.edit());
    act(() => result.current.form.setRole("cousin"));

    expect(commitOther).toHaveBeenCalledTimes(1);
    expect(commitOther).toHaveBeenCalledWith(ruth, "friend", null);
    expect(result.current.form.submit()?.input).toEqual({
      other: "existing",
      otherType: "person",
      otherId: "p-ruth",
      relationshipId: "r-ruth",
      otherRole: "cousin",
      otherRoleNote: null,
    });
  });
});

describe("onlyPartnerOf", () => {
  const neighbor = (
    id: string,
    otherRole: RelationshipNeighbor["otherRole"],
    origin: RelationshipNeighbor["origin"] = "explicit",
  ): RelationshipNeighbor => ({
    relationshipId: `r-${id}`,
    otherType: "person",
    otherId: id,
    otherLabel: id,
    otherStanding: "published",
    otherRole,
    otherRoleLabel: otherRole,
    otherRoleNote: null,
    origin,
  });

  it("starts on the one partner, and on nobody when there are several", () => {
    expect(
      onlyPartnerOf([neighbor("mary", "wife"), neighbor("harry", "brother")]),
    ).toMatchObject({ kind: "existing", id: "mary", relationshipId: "r-mary" });
    expect(
      onlyPartnerOf([neighbor("mary", "wife"), neighbor("violet", "partner")]),
    ).toBeNull();
    expect(onlyPartnerOf([neighbor("mary", "wife", "derived")])).toBeNull();
  });
});
