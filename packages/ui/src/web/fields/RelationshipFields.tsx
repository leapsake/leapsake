import {
  type EntityType,
  type RelationshipCandidateRef,
  type RelationshipDraft,
  type RelationshipRole,
} from "@leapsake/schema";
import { useId, useState } from "react";
import { useRelationshipForm } from "../../headless/index.js";
import { useMessages } from "../../messages/index.js";
import { Field } from "../primitives/Field.js";

/** A person or pet the subject can be related to; core's candidates fit it. */
export type RelationshipCandidate = RelationshipCandidateRef;

/**
 * One relationship's fields: the other end's role, which narrows the names on
 * offer, then who they are. `posted` names and requires the inputs the route
 * action reads; with the other end fixed, its name is shown, not asked for.
 */
export function RelationshipFields({
  fields,
  set,
  setRole,
  roleOptions,
  otherTypes,
  candidates,
  otherFixed = false,
  posted = true,
}: {
  fields: RelationshipDraft;
  set: <K extends keyof RelationshipDraft>(
    key: K,
    value: RelationshipDraft[K],
  ) => void;
  setRole: (role: RelationshipRole) => void;
  roleOptions: readonly { role: RelationshipRole; label: string }[];
  otherTypes: readonly EntityType[];
  candidates: readonly RelationshipCandidate[];
  otherFixed?: boolean;
  posted?: boolean;
}) {
  const m = useMessages();
  const listId = `${useId()}-candidates`;
  const other = fields.other;
  const otherText =
    other === null ? "" : other.kind === "typed" ? other.text : other.label;
  const role = fields.role;
  const offersRole = role === null || roleOptions.some((r) => r.role === role);

  return (
    <>
      <Field label={m.relationshipForm.role}>
        <select
          name={posted ? "otherRole" : undefined}
          value={role ?? ""}
          onChange={(event) => setRole(event.target.value as RelationshipRole)}
          required={posted}
        >
          <option value="" disabled>
            {m.relationshipForm.rolePick}
          </option>
          {!offersRole && <option value={role}>{role}</option>}
          {roleOptions.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>{" "}
      <Field label={m.relationshipForm.name}>
        {otherFixed ? (
          <output>{otherText}</output>
        ) : (
          <input
            name={posted ? "otherName" : undefined}
            list={listId}
            value={otherText}
            onChange={(event) =>
              set("other", { kind: "typed", text: event.target.value })
            }
            placeholder={m.relationshipForm.namePlaceholder}
            required={posted}
          />
        )}
      </Field>
      {!otherFixed && (
        <datalist id={listId}>
          {candidates
            .filter((c) => otherTypes.includes(c.type))
            .map((c) => (
              <option key={`${c.type}:${c.id}`} value={c.label} />
            ))}
        </datalist>
      )}
      {role === "other" && (
        <>
          {" "}
          <Field label={m.relationshipForm.note}>
            <input
              name={posted ? "otherRoleNote" : undefined}
              value={fields.note}
              onChange={(event) => set("note", event.target.value)}
              required={posted}
            />
          </Field>
        </>
      )}
    </>
  );
}

/**
 * The relationship rows embedded in the People & Pets create forms. Each row
 * that shapes cleanly posts a hidden `relationships` JSON blob of its b-side.
 */
export function StagedRelationshipsFields({
  subjectType,
  candidates,
  initialRows = 0,
}: {
  subjectType: EntityType;
  candidates: readonly RelationshipCandidate[];
  /** How many empty rows to show up front (1 nudges owner entry on the Pet form). */
  initialRows?: number;
}) {
  const m = useMessages();
  const [keys, setKeys] = useState(() =>
    Array.from({ length: initialRows }, (_, i) => i),
  );

  return (
    <fieldset>
      <legend>{m.relationshipForm.groupLegend}</legend>
      {keys.map((key) => (
        <StagedRelationshipRow
          key={key}
          subjectType={subjectType}
          candidates={candidates}
          onRemove={() =>
            setKeys((current) => current.filter((k) => k !== key))
          }
        />
      ))}
      <button
        type="button"
        onClick={() =>
          setKeys((current) => [...current, Math.max(-1, ...current) + 1])
        }
      >
        {m.relationshipForm.addRow}
      </button>
    </fieldset>
  );
}

function StagedRelationshipRow({
  subjectType,
  candidates,
  onRemove,
}: {
  subjectType: EntityType;
  candidates: readonly RelationshipCandidate[];
  onRemove: () => void;
}) {
  const m = useMessages();
  const form = useRelationshipForm({ subjectType, candidates });
  const shaped = form.submit();
  const input = shaped?.input;

  return (
    <div>
      <RelationshipFields
        posted={false}
        fields={form.fields}
        set={form.set}
        setRole={form.setRole}
        roleOptions={form.roleOptions}
        otherTypes={form.otherTypes}
        candidates={candidates}
      />{" "}
      <button type="button" onClick={onRemove}>
        {m.common.remove}
      </button>
      {input?.other === "existing" && (
        <input
          type="hidden"
          name="relationships"
          value={JSON.stringify({
            bType: input.otherType,
            bId: input.otherId,
            bRole: input.otherRole,
            bRoleNote: input.otherRoleNote,
          })}
        />
      )}
    </div>
  );
}
