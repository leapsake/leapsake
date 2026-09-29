import {
  type EntityType,
  type RelationshipDraft,
  type RelationshipNeighbor,
  type RelationshipRole,
  isRomanticRole,
} from "@leapsake/schema";
import { useState } from "react";

/** Who a party field holds; a `new` one is a name until saved or edited,
 *  and `addedHere` marks one the field wrote. */
export type PartyChoice =
  | {
      kind: "existing";
      type: EntityType;
      id: string;
      label: string;
      relationshipId?: string;
      addedHere?: boolean;
    }
  | { kind: "new"; type: EntityType; name: string; label: string };

export type NewParty = Extract<PartyChoice, { kind: "new" }>;

/** A new party once written with the relationship that holds them. */
export interface CommittedParty {
  id: string;
  relationshipId: string;
}

/** A chosen party's Edit (writes a new one through `commit`, then opens it)
 *  and Remove (also removes the relationship Edit wrote). */
export function usePartyField({
  value,
  onChange,
  commit,
  open,
  removeRelationship,
  onFailure,
}: {
  value: PartyChoice | null;
  onChange: (value: PartyChoice | null) => void;
  commit?: (party: NewParty) => Promise<CommittedParty>;
  open: (party: { type: EntityType; id: string }) => void;
  removeRelationship: (relationshipId: string) => Promise<void>;
  onFailure: (action: "edit" | "remove", error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function edit() {
    if (value === null) return;
    let target = value;
    if (target.kind === "new") {
      if (commit === undefined) return;
      const written = await commit(target);
      target = {
        kind: "existing",
        type: target.type,
        id: written.id,
        label: target.label,
        relationshipId: written.relationshipId,
        addedHere: true,
      };
      onChange(target);
    }
    open(target);
  }

  async function remove() {
    if (
      value?.kind === "existing" &&
      value.addedHere === true &&
      value.relationshipId !== undefined
    )
      await removeRelationship(value.relationshipId);
    onChange(null);
  }

  const run = async (work: () => Promise<void>, action: "edit" | "remove") => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      onFailure(action, e);
    } finally {
      setBusy(false);
    }
  };

  return {
    canEdit: value?.kind === "existing" || commit !== undefined,
    busy,
    edit: () => run(edit, "edit"),
    remove: () => run(remove, "remove"),
  };
}

/** The `commit` for a relationship's other end, which writes the relationship
 *  too; none until the draft has a role, and a note for `other`. */
export function relationshipCommit(
  draft: RelationshipDraft,
  commitOther?: (
    party: NewParty,
    role: RelationshipRole,
    note: string | null,
  ) => Promise<CommittedParty>,
): ((party: NewParty) => Promise<CommittedParty>) | undefined {
  const { role } = draft;
  const note = draft.note.trim();
  if (commitOther === undefined || role === null) return undefined;
  if (role === "other" && note === "") return undefined;
  return (party) => commitOther(party, role, role === "other" ? note : null);
}

/** The one explicit partner a couple's occasion starts on, if any. */
export function onlyPartnerOf(
  neighbors: readonly RelationshipNeighbor[],
): PartyChoice | null {
  const partners = neighbors.filter(
    (n) =>
      n.origin === "explicit" &&
      n.otherType === "person" &&
      isRomanticRole(n.otherRole),
  );
  const [only] = partners;
  return partners.length === 1 && only !== undefined
    ? {
        kind: "existing",
        type: "person",
        id: only.otherId,
        label: only.otherLabel,
        relationshipId: only.relationshipId,
      }
    : null;
}
