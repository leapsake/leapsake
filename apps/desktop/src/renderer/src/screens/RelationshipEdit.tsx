import {
  type EntityType,
  type RelationshipNeighbor,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useMemo, useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";

/** The subject entity the edited relationship hangs off of. */
interface Subject {
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
 * Edit the role of an existing (explicit) relationship. The other end is fixed —
 * only its role changes; the subject's own role is re-derived as the neutral
 * inverse, mirroring {@link RelationshipForm}'s add flow. The visible input holds
 * a display label; the resolved machine value rides a hidden input the action
 * consumes, and the action supplies the subject endpoint from the route.
 */
export function RelationshipEdit() {
  const { subject, neighbor } = useLoaderData() as {
    subject: Subject;
    neighbor: RelationshipNeighbor;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const roleByLabel = useMemo(
    () => roleMap(neighbor.otherType, subject.type),
    [neighbor.otherType, subject.type],
  );

  const [roleText, setRoleText] = useState(neighbor.otherRoleLabel);
  const [note, setNote] = useState(neighbor.otherRoleNote ?? "");

  const otherRole = roleByLabel.get(roleText);
  const ready = otherRole !== undefined;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, href: subjectPath },
          { label: "Edit relationship" },
        ]}
      />
      <Form method="post">
        <header>
          <h1>Edit relationship</h1>
          <button type="submit" disabled={submitting || !ready}>
            Save
          </button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </header>

        {/* Resolved machine value for the action. */}
        <input type="hidden" name="otherRole" value={otherRole ?? ""} />

        <fieldset disabled={submitting}>
          <p>{neighbor.otherLabel}</p>
          <label>
            Role{" "}
            <input
              list="relationship-edit-role"
              value={roleText}
              onChange={(event) => setRoleText(event.target.value)}
              placeholder="role"
              required
            />
          </label>
          <datalist id="relationship-edit-role">
            {rolesForPair(neighbor.otherType, subject.type).map((role) => (
              <option key={role.role} value={role.label} />
            ))}
          </datalist>
          {otherRole === "other" && (
            <label>
              Note{" "}
              <input
                name="otherRoleNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
        </fieldset>
      </Form>
    </main>
  );
}
