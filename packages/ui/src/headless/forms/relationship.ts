import {
  type EntityType,
  type RelationshipCandidateRef,
  type RelationshipDraft,
  type RelationshipRole,
  otherTypesFor,
  relationshipDraftOf,
  relationshipDraftWithRole,
  relationshipInputOf,
  rolesForPair,
  rolesForSubject,
} from "@leapsake/schema";
import { useMemo } from "react";
import { useDraftForm } from "./use-draft-form.js";

/**
 * The relationship form's state, with the roles to offer: every role the
 * subject could stand opposite, or with the other end fixed, those it can hold.
 */
export function useRelationshipForm({
  subjectType,
  initial,
  otherFixed = false,
  candidates = [],
}: {
  subjectType: EntityType;
  initial?: RelationshipDraft;
  otherFixed?: boolean;
  candidates?: readonly RelationshipCandidateRef[];
}) {
  const form = useDraftForm(
    () => initial ?? relationshipDraftOf(),
    (draft) => relationshipInputOf(draft, candidates),
  );
  const { update } = form;
  const fixedType =
    otherFixed && form.fields.other?.kind !== "typed"
      ? form.fields.other?.type
      : undefined;
  const roleOptions = useMemo(
    () =>
      fixedType === undefined
        ? rolesForSubject(subjectType)
        : rolesForPair(fixedType, subjectType),
    [fixedType, subjectType],
  );
  return {
    ...form,
    roleOptions,
    otherTypes: otherTypesFor(form.fields.role),
    setRole: (role: RelationshipRole) =>
      update((draft) => relationshipDraftWithRole(draft, role)),
  };
}
