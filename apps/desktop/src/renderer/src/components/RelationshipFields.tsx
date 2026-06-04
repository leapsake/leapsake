import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { useState } from "react";
import { useNavigation } from "react-router-dom";
import type { RelationshipCandidate } from "./RelationshipForm";

/** One editable relationship row's local state, keyed for stable rendering. */
interface RelRow {
  key: number;
  entityText: string;
  roleText: string;
  note: string;
}

let nextRowKey = 0;

function emptyRow(): RelRow {
  return { key: nextRowKey++, entityText: "", roleText: "", note: "" };
}

function roleMap(
  otherType: EntityType,
  subjectType: EntityType,
): Map<string, RelationshipRole> {
  return new Map(
    rolesForPair(otherType, subjectType).map((r) => [r.label, r.role]),
  );
}

/**
 * The relationships section embedded in the People & Pets *create* forms, so an
 * entity and its relationships are saved together (e.g. a pet plus its owner in
 * one go). Each row mirrors {@link RelationshipForm}: pick the other entity and
 * its role; the subject's own role is the implied inverse. Every fully-resolved
 * row emits a hidden `relationships` input carrying a JSON blob of the resolved
 * b-side values; the create action reads them with `formData.getAll`.
 */
export function RelationshipFields({
  subjectType,
  candidates,
  initialRows = 0,
}: {
  subjectType: EntityType;
  candidates: RelationshipCandidate[];
  /** How many empty rows to show up front (1 nudges owner entry on the Pet form). */
  initialRows?: number;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [rows, setRows] = useState<RelRow[]>(() =>
    Array.from({ length: initialRows }, emptyRow),
  );

  function patchRow(key: number, patch: Partial<RelRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <fieldset disabled={submitting}>
      <legend>Relationships</legend>

      <datalist id="rel-fields-entities">
        {candidates.map((candidate) => (
          <option
            key={`${candidate.type}:${candidate.id}`}
            value={candidate.label}
          />
        ))}
      </datalist>
      <datalist id="rel-fields-roles-person">
        {rolesForPair("person", subjectType).map((role) => (
          <option key={role.role} value={role.label} />
        ))}
      </datalist>
      <datalist id="rel-fields-roles-pet">
        {rolesForPair("pet", subjectType).map((role) => (
          <option key={role.role} value={role.label} />
        ))}
      </datalist>

      {rows.map((row) => {
        const selected = candidates.find((c) => c.label === row.entityText);
        const otherType: EntityType = selected?.type ?? "person";
        const bRole = roleMap(otherType, subjectType).get(row.roleText);
        const trimmedNote = row.note.trim();
        const bRoleNote =
          bRole === "other" && trimmedNote.length > 0 ? trimmedNote : null;
        const resolved = selected !== undefined && bRole !== undefined;

        return (
          <div key={row.key}>
            <label>
              Name{" "}
              <input
                list="rel-fields-entities"
                value={row.entityText}
                onChange={(event) =>
                  patchRow(row.key, { entityText: event.target.value })
                }
                placeholder="Start typing a name"
              />
            </label>{" "}
            <label>
              Role{" "}
              <input
                list={
                  otherType === "pet"
                    ? "rel-fields-roles-pet"
                    : "rel-fields-roles-person"
                }
                value={row.roleText}
                onChange={(event) =>
                  patchRow(row.key, { roleText: event.target.value })
                }
                placeholder="role"
              />
            </label>
            {bRole === "other" && (
              <label>
                {" "}
                Note{" "}
                <input
                  value={row.note}
                  onChange={(event) =>
                    patchRow(row.key, { note: event.target.value })
                  }
                />
              </label>
            )}{" "}
            <button type="button" onClick={() => removeRow(row.key)}>
              Remove
            </button>
            {resolved && (
              <input
                type="hidden"
                name="relationships"
                value={JSON.stringify({
                  bType: selected.type,
                  bId: selected.id,
                  bRole,
                  bRoleNote,
                })}
              />
            )}
          </div>
        );
      })}

      <button type="button" onClick={() => setRows((c) => [...c, emptyRow()])}>
        Add relationship
      </button>
    </fieldset>
  );
}
