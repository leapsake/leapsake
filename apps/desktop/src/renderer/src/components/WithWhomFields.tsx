import {
  type MilestoneKind,
  type RelationshipNeighbor,
  type RelationshipRole,
  rolesForPair,
  spouseNeighbors,
} from "@leapsake/schema";
import { type RelationshipCandidate } from "@leapsake/ui/web";
import { useEffect, useMemo, useState } from "react";

/** The other-end role a freshly created relationship gets, defaulted by kind. */
const DEFAULT_ROLE: Partial<Record<MilestoneKind, RelationshipRole>> = {
  "first-date": "partner",
  wedding: "spouse",
  met: "friend",
};

/**
 * The "with whom?" step for a relationship-kind milestone (Met / First Date /
 * Wedding) added from a Person. It resolves the other party into one of three
 * machine outcomes, emitted as hidden inputs the route action consumes:
 *
 * - **bind** — the chosen person already shares an explicit relationship with the
 *   subject; the milestone attaches to it (`relId`). When several exist the user
 *   disambiguates.
 * - **create** — no relationship exists yet; one is created with a kind-defaulted
 *   role (`relRole`, editable for Met) and the milestone attaches to it.
 * - **unbound** — only for Wedding (`allowUnbound`): leaving the field **empty**
 *   stores the wedding on the person ("spouse unknown"), re-bindable later.
 *
 * For a Wedding, if the subject has exactly one explicit spouse edge it is
 * pre-filled so the common case binds with no prompt. The parent learns whether a
 * valid choice is in hand via {@link onReadyChange}: a Wedding is always ready
 * (an empty field is the valid "unknown" outcome), while Met / First Date require
 * a matched person. A non-empty field that matches no candidate is never ready,
 * so a half-typed name can't be mistaken for "unknown".
 */
export function WithWhomFields({
  kind,
  candidates,
  neighbors,
  allowUnbound,
  onReadyChange,
}: {
  kind: MilestoneKind;
  candidates: RelationshipCandidate[];
  neighbors: RelationshipNeighbor[];
  allowUnbound: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  // Seed a Wedding from the lone explicit spouse edge, if there is exactly one.
  const inferredOther = useMemo(() => {
    if (kind !== "wedding") return "";
    const spouses = spouseNeighbors(neighbors);
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

  // The role for a newly-created relationship: kind's default, editable for Met.
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
      {/* Resolved machine values for the action. */}
      <input type="hidden" name="relMode" value={mode} />
      <input type="hidden" name="relId" value={relId} />
      <input type="hidden" name="withType" value={selectedOther?.type ?? ""} />
      <input type="hidden" name="withId" value={selectedOther?.id ?? ""} />
      <input type="hidden" name="relRole" value={createRole} />

      <label>
        Person{" "}
        <input
          list="with-whom-candidates"
          value={otherText}
          onChange={(event) => {
            setOtherText(event.target.value);
            setChosenRelId("");
          }}
          placeholder={
            allowUnbound ? "Leave blank if unknown" : "Start typing a name"
          }
        />
      </label>
      <datalist id="with-whom-candidates">
        {candidates.map((candidate) => (
          <option
            key={`${candidate.type}:${candidate.id}`}
            value={candidate.label}
          />
        ))}
      </datalist>

      {existing.length > 1 && (
        <label>
          {" "}
          Which relationship?{" "}
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
        </label>
      )}

      {kind === "met" && selectedOther && existing.length === 0 && (
        <>
          <label>
            {" "}
            Relationship{" "}
            <input
              list="with-whom-roles"
              value={roleText}
              onChange={(event) => setRoleText(event.target.value)}
              placeholder="Friend"
            />
          </label>
          <datalist id="with-whom-roles">
            {rolesForPair(selectedOther.type, "person").map((r) => (
              <option key={r.role} value={r.label} />
            ))}
          </datalist>
        </>
      )}
    </>
  );
}
