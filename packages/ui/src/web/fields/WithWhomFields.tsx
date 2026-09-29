import {
  type MilestoneKind,
  type RelationshipNeighbor,
  type RelationshipRole,
  rolesForPair,
  spouseNeighbors,
} from "@leapsake/schema";
import { useEffect, useId, useMemo, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { Field } from "../primitives/Field.js";
import { type RelationshipCandidate } from "./RelationshipFields.js";

/** The other-end role a new relationship gets, by milestone kind. */
const DEFAULT_ROLE: Partial<Record<MilestoneKind, RelationshipRole>> = {
  "first-date": "partner",
  wedding: "spouse",
  met: "friend",
};

/**
 * The “with whom?” step for a relationship-kind milestone: binds to an existing
 * relationship, creates one, or (for a wedding left blank) stays unbound.
 */
export function WithWhomFields({
  kind,
  candidates,
  neighbors,
  allowUnbound,
  onReadyChange,
}: {
  kind: MilestoneKind;
  candidates: readonly RelationshipCandidate[];
  neighbors: readonly RelationshipNeighbor[];
  allowUnbound: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  const m = useMessages();
  const ids = useId();
  const candidateListId = `${ids}-candidates`;
  const roleListId = `${ids}-roles`;

  // Seed a Wedding from the lone explicit spouse edge, if there is exactly one.
  const inferredOther = useMemo(() => {
    if (kind !== "wedding") return "";
    // Copied: the schema helper takes a mutable array.
    const spouses = spouseNeighbors([...neighbors]);
    return spouses.length === 1 ? spouses[0].otherLabel : "";
  }, [kind, neighbors]);

  const [otherText, setOtherText] = useState(inferredOther);
  const [chosenRelId, setChosenRelId] = useState("");
  const [roleText, setRoleText] = useState("");

  // Reset the picker (and re-seed the inference) whenever the kind changes.
  useEffect(() => {
    setOtherText(inferredOther);
    setChosenRelId("");
    setRoleText("");
  }, [kind, inferredOther]);

  const selectedOther = useMemo(
    () => candidates.find((c) => c.label === otherText),
    [candidates, otherText],
  );

  // Explicit edges the subject already shares with the chosen person.
  const existing = useMemo(
    () =>
      selectedOther
        ? neighbors.filter(
            (n) =>
              n.origin === "explicit" &&
              n.otherType === selectedOther.type &&
              n.otherId === selectedOther.id,
          )
        : [],
    [neighbors, selectedOther],
  );

  const roleByLabel = useMemo(
    () =>
      selectedOther
        ? new Map(
            rolesForPair(selectedOther.type, "person").map((r) => [
              r.label,
              r.role,
            ]),
          )
        : new Map<string, RelationshipRole>(),
    [selectedOther],
  );

  // A new relationship's role: the kind's default, editable for Met.
  const createRole: RelationshipRole =
    (kind === "met" ? roleByLabel.get(roleText) : undefined) ??
    DEFAULT_ROLE[kind] ??
    "friend";

  let mode: "bind" | "create" | "unbound" | "" = "";
  let relId = "";
  if (selectedOther) {
    if (existing.length > 0) {
      mode = "bind";
      relId = chosenRelId || existing[0].relationshipId;
    } else {
      mode = "create";
    }
  } else if (allowUnbound && otherText.trim() === "") {
    // An empty field on a Wedding means "spouse unknown" — store it unbound.
    mode = "unbound";
  }

  useEffect(() => onReadyChange(mode !== ""), [mode, onReadyChange]);

  return (
    <>
      {/* Resolved values for the action. */}
      <input type="hidden" name="relMode" value={mode} />
      <input type="hidden" name="relId" value={relId} />
      <input type="hidden" name="withType" value={selectedOther?.type ?? ""} />
      <input type="hidden" name="withId" value={selectedOther?.id ?? ""} />
      <input type="hidden" name="relRole" value={createRole} />

      <Field label={m.withWhom.person}>
        <input
          list={candidateListId}
          value={otherText}
          onChange={(event) => {
            setOtherText(event.target.value);
            setChosenRelId("");
          }}
          placeholder={
            allowUnbound
              ? m.withWhom.unknownPlaceholder
              : m.relationshipForm.namePlaceholder
          }
        />
      </Field>
      <datalist id={candidateListId}>
        {candidates.map((candidate) => (
          <option
            key={`${candidate.type}:${candidate.id}`}
            value={candidate.label}
          />
        ))}
      </datalist>

      {existing.length > 1 && (
        <>
          {" "}
          <Field label={m.withWhom.whichRelationship}>
            <select
              value={chosenRelId || existing[0].relationshipId}
              onChange={(event) => setChosenRelId(event.target.value)}
            >
              {existing.map((n) => (
                <option key={n.relationshipId} value={n.relationshipId}>
                  {n.otherRoleLabel}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {kind === "met" && selectedOther && existing.length === 0 && (
        <>
          {" "}
          <Field label={m.withWhom.relationship}>
            <input
              list={roleListId}
              value={roleText}
              onChange={(event) => setRoleText(event.target.value)}
              placeholder={m.withWhom.rolePlaceholder}
            />
          </Field>
          <datalist id={roleListId}>
            {rolesForPair(selectedOther.type, "person").map((r) => (
              <option key={r.role} value={r.label} />
            ))}
          </datalist>
        </>
      )}
    </>
  );
}
