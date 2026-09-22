import { useCallback, useEffect } from "react";
import { isRomanticRole } from "@leapsake/schema";
import { type PartyChoice, PartyField } from "./PartyField";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";

const LABELS = {
  wedding: "Who’s your spouse?",
  "first-date": "Who’s your partner?",
  other: "Who’s it with?",
} as const;

/** The role a new partner is recorded in, as `milestones.linkPartner` does. */
const ROLE = { wedding: "spouse", "first-date": "partner" } as const;

/**
 * Who a couple's occasion held by one person is with. Starts on their partner
 * when they have exactly one; `undefined` means not yet chosen or pre-filled.
 */
export function PartnerField({
  kind,
  personId,
  isSelf,
  value,
  onChange,
}: {
  kind: "wedding" | "first-date";
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
    const partners = data[1].filter(
      (n) =>
        n.origin === "explicit" &&
        n.otherType === "person" &&
        isRomanticRole(n.otherRole),
    );
    const [only] = partners;
    onChange(
      partners.length === 1 && only !== undefined
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
      label={isSelf ? LABELS[kind] : LABELS.other}
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
            otherRole: ROLE[kind],
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
