import type { CoreApi } from "@leapsake/core";
import type {
  EntityType,
  RelationshipDraftResult,
  RelationshipRole,
} from "@leapsake/schema";
import type { CommittedParty, NewParty } from "@leapsake/ui/headless";

type RelationshipInput = Extract<
  RelationshipDraftResult,
  { ok: true }
>["input"];

/**
 * Add relationship's two writes from a subject: Edit's on somebody new, and Save's,
 * which revises the relationship Edit wrote rather than adding a second.
 */
export function relationshipWrites(
  core: CoreApi,
  subjectType: EntityType,
  subjectId: string,
) {
  return {
    async commitOther(
      party: NewParty,
      otherRole: RelationshipRole,
      otherRoleNote: string | null,
    ): Promise<CommittedParty> {
      const { other, relationship } =
        await core.relationships.createWithNewOther({
          subjectType,
          subjectId,
          otherType: party.type,
          otherName: party.name,
          otherRole,
          otherRoleNote,
        });
      return { id: other.id, relationshipId: relationship.id };
    },

    async save(value: RelationshipInput): Promise<void> {
      if (value.other === "existing" && value.relationshipId !== undefined)
        await core.relationships.editFromSubject({
          subjectType,
          subjectId,
          relId: value.relationshipId,
          otherRole: value.otherRole,
          otherRoleNote: value.otherRoleNote,
        });
      else
        await (value.other === "existing"
          ? core.relationships.createFromSubject({
              subjectType,
              subjectId,
              ...value,
            })
          : core.relationships.createWithNewOther({
              subjectType,
              subjectId,
              ...value,
            }));
    },
  };
}
