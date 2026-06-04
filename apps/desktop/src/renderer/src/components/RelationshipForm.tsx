import {
  type EntityType,
  type RelationshipRole,
  inverseRole,
  roleDefs,
  rolesForHolder,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router-dom";

/** A pickable other end for the relationship typeahead. */
export interface RelationshipCandidate {
  type: EntityType;
  id: string;
  label: string;
}

/** Map each allowed role's display label back to its slug for a holder type. */
function roleMap(type: EntityType): Map<string, RelationshipRole> {
  return new Map(rolesForHolder(type).map((r) => [r.label, r.role]));
}

/**
 * Add-relationship form, rendered on a subject entity's page. The user picks the
 * *other* entity and the *other* end's role (what shows next to them here); the
 * subject's own role auto-fills with the gender-neutral inverse and stays
 * editable. Visible inputs hold display labels; hidden inputs carry the resolved
 * machine values (`bType`/`bId`/`bRole`/`aRole`) the action consumes — the action
 * supplies the subject endpoint from the route.
 */
export function RelationshipForm({
  subjectLabel,
  subjectType,
  candidates,
  cancelTo,
}: {
  subjectLabel: string;
  subjectType: EntityType;
  candidates: RelationshipCandidate[];
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [entityText, setEntityText] = useState("");
  const [bRoleText, setBRoleText] = useState("");
  const [aRoleText, setARoleText] = useState("");
  const [bNote, setBNote] = useState("");
  const [aNote, setANote] = useState("");

  const selected = useMemo(
    () => candidates.find((c) => c.label === entityText),
    [candidates, entityText],
  );
  const otherType: EntityType = selected?.type ?? "person";

  const bRoleByLabel = useMemo(() => roleMap(otherType), [otherType]);
  const aRoleByLabel = useMemo(() => roleMap(subjectType), [subjectType]);
  const bRole = bRoleByLabel.get(bRoleText);
  const aRole = aRoleByLabel.get(aRoleText);

  function onBRoleChange(value: string) {
    setBRoleText(value);
    const role = bRoleByLabel.get(value);
    if (role) setARoleText(roleDefs[inverseRole(role)].label);
  }

  const ready =
    selected !== undefined && bRole !== undefined && aRole !== undefined;

  return (
    <Form method="post">
      <header>
        <h1>Add relationship</h1>
        <button type="submit" disabled={submitting || !ready}>
          Add
        </button>{" "}
        <Link to={cancelTo}>Cancel</Link>
      </header>

      {/* Resolved machine values for the action. */}
      <input type="hidden" name="bType" value={selected?.type ?? ""} />
      <input type="hidden" name="bId" value={selected?.id ?? ""} />
      <input type="hidden" name="bRole" value={bRole ?? ""} />
      <input type="hidden" name="aRole" value={aRole ?? ""} />

      <fieldset disabled={submitting}>
        <label>
          Who?{" "}
          <input
            list="relationship-entities"
            value={entityText}
            onChange={(event) => setEntityText(event.target.value)}
            placeholder="Start typing a name"
            required
          />
        </label>
        <datalist id="relationship-entities">
          {candidates.map((candidate) => (
            <option
              key={`${candidate.type}:${candidate.id}`}
              value={candidate.label}
            />
          ))}
        </datalist>{" "}
        <label>
          They are {subjectLabel}'s{" "}
          <input
            list="relationship-brole"
            value={bRoleText}
            onChange={(event) => onBRoleChange(event.target.value)}
            placeholder="role"
            required
          />
        </label>
        <datalist id="relationship-brole">
          {rolesForHolder(otherType).map((role) => (
            <option key={role.role} value={role.label} />
          ))}
        </datalist>
        {bRole === "other" && (
          <label>
            Note{" "}
            <input
              name="bRoleNote"
              value={bNote}
              onChange={(event) => setBNote(event.target.value)}
            />
          </label>
        )}{" "}
        <label>
          {subjectLabel} is their{" "}
          <input
            list="relationship-arole"
            value={aRoleText}
            onChange={(event) => setARoleText(event.target.value)}
            placeholder="role"
            required
          />
        </label>
        <datalist id="relationship-arole">
          {rolesForHolder(subjectType).map((role) => (
            <option key={role.role} value={role.label} />
          ))}
        </datalist>
        {aRole === "other" && (
          <label>
            Note{" "}
            <input
              name="aRoleNote"
              value={aNote}
              onChange={(event) => setANote(event.target.value)}
            />
          </label>
        )}
      </fieldset>
    </Form>
  );
}
