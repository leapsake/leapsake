import type {
  EntityType,
  RelationshipDraft,
  RelationshipDraftErrors,
} from "@leapsake/schema";
import { useRelationshipForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
import {
  type RelationshipCandidate,
  RelationshipFields,
} from "../fields/RelationshipFields.js";
import { FormShell } from "../patterns/FormShell.js";

/**
 * Add or edit a relationship from a subject's page: {@link useRelationshipForm}'s
 * draft rendered by {@link RelationshipFields}. With `initial` the other end is
 * fixed and only its role is edited; core derives the subject's own.
 */
export function RelationshipForm({
  subjectType,
  candidates = [],
  initial,
  cancelTo,
  submitting,
}: {
  subjectType: EntityType;
  candidates?: readonly RelationshipCandidate[];
  /** The relationship being edited, its other end fixed. */
  initial?: RelationshipDraft;
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const editing = initial !== undefined;
  const form = useRelationshipForm({
    subjectType,
    initial,
    otherFixed: editing,
    candidates,
  });

  return (
    <FormShell
      title={
        editing ? m.relationshipForm.editHeading : m.relationshipForm.heading
      }
      submitLabel={editing ? m.common.save : m.relationshipForm.submit}
      cancelTo={cancelTo}
      submitting={submitting}
      problem={relationshipProblem(form.errors, m)}
    >
      <RelationshipFields
        fields={form.fields}
        set={form.set}
        setRole={form.setRole}
        roleOptions={form.roleOptions}
        otherTypes={form.otherTypes}
        candidates={candidates}
        otherFixed={editing}
      />
    </FormShell>
  );
}

function relationshipProblem(
  errors: RelationshipDraftErrors,
  m: Messages,
): string | undefined {
  const t = m.relationshipForm;
  if (errors.role === "required") return t.roleRequired;
  if (errors.other === "required") return t.otherRequired;
  if (errors.other === "unknown") return t.otherUnknown;
  if (errors.other === "ambiguous") return t.otherAmbiguous;
  if (errors.other === "notHolder") return t.otherNotHolder;
  if (errors.note === "required") return t.noteRequired;
  return undefined;
}
