import {
  type EntityType,
  type RelationshipRole,
  inverseRole,
  rolesForPair,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router-dom";

/** A pickable other end for the relationship typeahead. */
export interface RelationshipCandidate {
  type: EntityType;
  id: string;
  label: string;
}

/** Map each pickable role's display label back to its slug for the chosen pair. */
function roleMap(
  otherType: EntityType,
  subjectType: EntityType,
): Map<string, RelationshipRole> {
  return new Map(
    rolesForPair(otherType, subjectType).map((r) => [r.label, r.role]),
  );
}

/**
 * Add-relationship form, rendered on a subject entity's page. The user picks the
 * *other* entity and that entity's role relative to the subject; the subject's
 * own role is the gender-neutral inverse and is submitted as a hidden value
 * rather than shown. Visible inputs hold display labels; hidden inputs carry the
 * resolved machine values (`bType`/`bId`/`bRole`/`aRole`) the action consumes —
 * the action supplies the subject endpoint from the route.
 */
export function RelationshipForm({
  subjectType,
  candidates,
  cancelTo,
}: {
  subjectType: EntityType;
  candidates: RelationshipCandidate[];
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [entityText, setEntityText] = useState("");
  const [roleText, setRoleText] = useState("");
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => candidates.find((c) => c.label === entityText),
    [candidates, entityText],
  );
  const otherType: EntityType = selected?.type ?? "person";

  const roleByLabel = useMemo(
    () => roleMap(otherType, subjectType),
    [otherType, subjectType],
  );
  const bRole = roleByLabel.get(roleText);
  const aRole = bRole ? inverseRole(bRole) : undefined;

  const ready = selected !== undefined && bRole !== undefined;

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
          Name{" "}
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
          Role{" "}
          <input
            list="relationship-role"
            value={roleText}
            onChange={(event) => setRoleText(event.target.value)}
            placeholder="role"
            required
          />
        </label>
        <datalist id="relationship-role">
          {rolesForPair(otherType, subjectType).map((role) => (
            <option key={role.role} value={role.label} />
          ))}
        </datalist>
        {bRole === "other" && (
          <label>
            Note{" "}
            <input
              name="bRoleNote"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
      </fieldset>
    </Form>
  );
}
