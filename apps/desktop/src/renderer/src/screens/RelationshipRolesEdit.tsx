import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

/** One endpoint of the relationship being edited. */
interface Partner {
  type: EntityType;
  id: string;
  label: string;
  role: RelationshipRole;
  roleLabel: string;
  roleNote: string | null;
}

/** Map each pickable role's display label back to its slug for the chosen pair. */
function roleMap(
  holderType: EntityType,
  otherType: EntityType,
): Map<string, RelationshipRole> {
  return new Map(
    rolesForPair(holderType, otherType).map((r) => [r.label, r.role]),
  );
}

/**
 * Edit *both* ends' roles of an explicit relationship at once, addressed by the
 * relationship itself rather than one partner. Each side gets its own picker and
 * the two are independent — neither role is derived from the other — so the user
 * can record both explicitly (e.g. Husband / Wife instead of Spouse / Husband).
 * The visible inputs hold display labels; resolved slugs ride hidden inputs the
 * action consumes.
 */
export function RelationshipRolesEdit() {
  const { relationshipId, title, partners } = useLoaderData() as {
    relationshipId: string;
    title: string;
    partners: [Partner, Partner];
  };
  const relPath = `/relationships/${relationshipId}`;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [a, b] = partners;
  // Each partner's picker lists roles it may hold opposite the other partner.
  const aRoleByLabel = useMemo(() => roleMap(a.type, b.type), [a.type, b.type]);
  const bRoleByLabel = useMemo(() => roleMap(b.type, a.type), [b.type, a.type]);

  const [aText, setAText] = useState(a.roleLabel);
  const [bText, setBText] = useState(b.roleLabel);
  const [aNote, setANote] = useState(a.roleNote ?? "");
  const [bNote, setBNote] = useState(b.roleNote ?? "");

  const aRole = aRoleByLabel.get(aText);
  const bRole = bRoleByLabel.get(bText);
  const ready = aRole !== undefined && bRole !== undefined;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: title, to: relPath },
          { label: "Edit roles" },
        ]}
      />
      <Form method="post">
        <header>
          <h1>Edit roles</h1>
          <button type="submit" disabled={submitting || !ready}>
            Save
          </button>{" "}
          <Link to={relPath}>Cancel</Link>
        </header>

        {/* Resolved machine values for the action. */}
        <input type="hidden" name="aRole" value={aRole ?? ""} />
        <input type="hidden" name="bRole" value={bRole ?? ""} />

        <fieldset disabled={submitting}>
          <label>
            {a.label}{" "}
            <input
              list="relationship-roles-a"
              value={aText}
              onChange={(event) => setAText(event.target.value)}
              placeholder="role"
              required
            />
          </label>
          <datalist id="relationship-roles-a">
            {rolesForPair(a.type, b.type).map((role) => (
              <option key={role.role} value={role.label} />
            ))}
          </datalist>
          {aRole === "other" && (
            <label>
              {" "}
              Note{" "}
              <input
                name="aRoleNote"
                value={aNote}
                onChange={(event) => setANote(event.target.value)}
              />
            </label>
          )}

          <label>
            {b.label}{" "}
            <input
              list="relationship-roles-b"
              value={bText}
              onChange={(event) => setBText(event.target.value)}
              placeholder="role"
              required
            />
          </label>
          <datalist id="relationship-roles-b">
            {rolesForPair(b.type, a.type).map((role) => (
              <option key={role.role} value={role.label} />
            ))}
          </datalist>
          {bRole === "other" && (
            <label>
              {" "}
              Note{" "}
              <input
                name="bRoleNote"
                value={bNote}
                onChange={(event) => setBNote(event.target.value)}
              />
            </label>
          )}
        </fieldset>
      </Form>
    </main>
  );
}
