import { useCallback, useEffect } from "react";
import { spouseNeighbors } from "@leapsake/schema";
import { type PartyChoice, PartyField } from "./PartyField";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";

const LABELS = { self: "Who’s your spouse?", other: "Who’s it with?" } as const;

/**
 * Who an anniversary held by one person is with. Starts on their spouse when
 * they have exactly one; `undefined` means not yet chosen or pre-filled.
 */
export function PartnerField({
  personId,
  isSelf,
  value,
  onChange,
}: {
  personId: string;
  isSelf: boolean;
  value: PartyChoice | null | undefined;
  onChange: (value: PartyChoice | null) => void;
}) {
  const core = useCore();
  const load = useCallback(
    () =>
      Promise.all([
        core.views.relationshipNew("person", personId),
        core.relationships.listForEntity("person", personId),
      ]),
    [core, personId],
  );
  const { data } = useFocusedData(load);

  useEffect(() => {
    if (data === null || value !== undefined) return;
    const spouses = spouseNeighbors(data[1]).filter(
      (n) => n.otherType === "person",
    );
    const [only] = spouses;
    onChange(
      spouses.length === 1 && only !== undefined
        ? {
            kind: "existing",
            type: "person",
            id: only.otherId,
            label: only.otherLabel,
            relationshipId: only.relationshipId,
          }
        : null,
    );
  }, [data, value, onChange]);

  if (data === null || data[0] === null) return null;

  return (
    <PartyField
      testID="partner-name"
      label={isSelf ? LABELS.self : LABELS.other}
      value={value ?? null}
      onChange={onChange}
      candidates={data[0].candidates}
      types={["person"]}
      commit={async (party) => {
        const { other, relationship } =
          await core.relationships.createWithNewOther({
            subjectType: "person",
            subjectId: personId,
            otherType: "person",
            otherName: party.name,
            otherRole: "spouse",
          });
        return { id: other.id, relationshipId: relationship.id };
      }}
    />
  );
}

/** The partner as `milestones.linkPartner` takes it. */
export function linkedPartner(
  choice: PartyChoice,
): { personId: string } | { name: string } {
  return choice.kind === "new"
    ? { name: choice.name }
    : { personId: choice.id };
}
