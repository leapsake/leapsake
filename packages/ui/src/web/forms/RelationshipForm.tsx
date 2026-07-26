import { type EntityType, inverseRole, rolesForPair } from "@leapsake/schema";
import { useId, useMemo, useState } from "react";
import { useMessages } from "../../messages/index.js";
import {
  type RelationshipCandidate,
  roleMap,
} from "../fields/RelationshipFields.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";

/**
 * Add-relationship form, rendered on a subject entity's page. The user picks the
 * *other* entity and that entity's role relative to the subject; the subject's
 * own role is the gender-neutral inverse and is submitted as a hidden value
 * rather than shown. Visible inputs hold display labels; hidden inputs carry the
 * resolved machine values (`bType`/`bId`/`bRole`/`aRole`) the write path
 * consumes — which supplies the subject endpoint from the route itself.
 *
 * Submit stays closed until both ends resolve, because a half-typed name is a
 * relationship to nobody.
 */
export function RelationshipForm({
  subjectType,
  candidates,
  cancelTo,
  submitting,
}: {
  subjectType: EntityType;
  candidates: readonly RelationshipCandidate[];
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const ids = useId();
  const entityListId = `${ids}-entities`;
  const roleListId = `${ids}-roles`;

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

  return (
    <FormShell
      title={m.relationshipForm.heading}
      submitLabel={m.relationshipForm.submit}
      cancelTo={cancelTo}
      submitting={submitting}
      canSubmit={selected !== undefined && bRole !== undefined}
      beforeFields={
        // Resolved machine values for the write path. Outside the fieldset so a
        // disabled form still posts them.
        <>
          <input type="hidden" name="bType" value={selected?.type ?? ""} />
          <input type="hidden" name="bId" value={selected?.id ?? ""} />
          <input type="hidden" name="bRole" value={bRole ?? ""} />
          <input type="hidden" name="aRole" value={aRole ?? ""} />
        </>
      }
    >
      <Field label={m.relationshipForm.name}>
        <input
          list={entityListId}
          value={entityText}
          onChange={(event) => setEntityText(event.target.value)}
          placeholder={m.relationshipForm.namePlaceholder}
          required
        />
      </Field>
      <datalist id={entityListId}>
        {candidates.map((candidate) => (
          <option
            key={`${candidate.type}:${candidate.id}`}
            value={candidate.label}
          />
        ))}
      </datalist>{" "}
      <Field label={m.relationshipForm.role}>
        <input
          list={roleListId}
          value={roleText}
          onChange={(event) => setRoleText(event.target.value)}
          placeholder={m.relationshipForm.rolePlaceholder}
          required
        />
      </Field>
      <datalist id={roleListId}>
        {rolesForPair(otherType, subjectType).map((role) => (
          <option key={role.role} value={role.label} />
        ))}
      </datalist>
      {bRole === "other" && (
        <Field label={m.relationshipForm.note}>
          <input
            name="bRoleNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      )}
    </FormShell>
  );
}
