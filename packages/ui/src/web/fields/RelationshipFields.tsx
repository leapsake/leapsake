import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { useId, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { Field } from "../primitives/Field.js";

/**
 * A person or pet the subject can be related to.
 *
 * Declared structurally rather than imported from `@leapsake/core`, so the
 * package stays off the data layer — core's `RelationshipCandidate` remains
 * assignable to it.
 */
export interface RelationshipCandidate {
  type: EntityType;
  id: string;
  label: string;
}

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

/** Map each pickable role's display label back to its slug for the chosen pair. */
export function roleMap(
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
 * one go). Each row mirrors the standalone add-relationship form: pick the other
 * entity and its role; the subject's own role is the implied inverse. Every
 * fully-resolved row emits a hidden `relationships` input carrying a JSON blob of
 * the resolved b-side values, which the write path reads with `formData.getAll`.
 */
export function RelationshipFields({
  subjectType,
  candidates,
  submitting,
  initialRows = 0,
}: {
  subjectType: EntityType;
  candidates: readonly RelationshipCandidate[];
  submitting: boolean;
  /** How many empty rows to show up front (1 nudges owner entry on the Pet form). */
  initialRows?: number;
}) {
  const m = useMessages();
  const ids = useId();
  const entityListId = `${ids}-entities`;
  const personRoleListId = `${ids}-roles-person`;
  const petRoleListId = `${ids}-roles-pet`;

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
      <legend>{m.relationshipForm.groupLegend}</legend>

      <datalist id={entityListId}>
        {candidates.map((candidate) => (
          <option
            key={`${candidate.type}:${candidate.id}`}
            value={candidate.label}
          />
        ))}
      </datalist>
      <datalist id={personRoleListId}>
        {rolesForPair("person", subjectType).map((role) => (
          <option key={role.role} value={role.label} />
        ))}
      </datalist>
      <datalist id={petRoleListId}>
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
            <Field label={m.relationshipForm.name}>
              <input
                list={entityListId}
                value={row.entityText}
                onChange={(event) =>
                  patchRow(row.key, { entityText: event.target.value })
                }
                placeholder={m.relationshipForm.namePlaceholder}
              />
            </Field>{" "}
            <Field label={m.relationshipForm.role}>
              <input
                list={otherType === "pet" ? petRoleListId : personRoleListId}
                value={row.roleText}
                onChange={(event) =>
                  patchRow(row.key, { roleText: event.target.value })
                }
                placeholder={m.relationshipForm.rolePlaceholder}
              />
            </Field>
            {bRole === "other" && (
              <>
                {" "}
                <Field label={m.relationshipForm.note}>
                  <input
                    value={row.note}
                    onChange={(event) =>
                      patchRow(row.key, { note: event.target.value })
                    }
                  />
                </Field>
              </>
            )}{" "}
            <button type="button" onClick={() => removeRow(row.key)}>
              {m.common.remove}
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
        {m.relationshipForm.addRow}
      </button>
    </fieldset>
  );
}
