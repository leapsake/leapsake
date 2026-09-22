import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { RelationshipCandidate } from "@leapsake/core";
import type { EntityType } from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { Typeahead } from "./Typeahead";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

const COPY = {
  add: (name: string) => `Add “${name}”`,
  addAs: (name: string, type: EntityType) => `Add “${name}” as a new ${type}`,
  edit: "Edit",
  remove: "Remove",
  editFailed: "Couldn’t save them",
  removeFailed: "Couldn’t remove them",
} as const;

/**
 * Who the field holds. A `new` one is only a name until the screen saves, or
 * until Edit writes them; `addedHere` marks one this field wrote.
 */
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

/** A new party once written with the relationship that holds them. */
export interface CommittedParty {
  id: string;
  relationshipId: string;
}

/**
 * The other party to a relationship: somebody already in the app, or a name
 * typed past the end of the list. Once chosen, a row with Edit and Remove.
 *
 * Nothing is written until the screen saves or Edit is tapped. Edit writes a
 * new party through `commit`, then opens their page; with no `commit` it waits.
 */
export function PartyField({
  label,
  value,
  onChange,
  candidates,
  types,
  commit,
  testID,
}: {
  label: string;
  value: PartyChoice | null;
  onChange: (value: PartyChoice | null) => void;
  candidates: readonly RelationshipCandidate[];
  /** What a new party may be, and which candidates are offered. */
  types: readonly EntityType[];
  commit?: (
    party: Extract<PartyChoice, { kind: "new" }>,
  ) => Promise<CommittedParty>;
  testID?: string;
}) {
  const core = useCore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (value === null) {
    return (
      <Typeahead<PartyChoice>
        testID={testID}
        label={label}
        value={null}
        options={candidates
          .filter((c) => types.includes(c.type))
          .map((c) => ({
            kind: "existing" as const,
            type: c.type,
            id: c.id,
            label: c.label,
          }))}
        createOptions={(typed) =>
          types.map((type) => ({
            kind: "new" as const,
            type,
            name: typed,
            label: typed,
          }))
        }
        renderOption={(option) => (
          <Text style={styles.rowText}>
            {option.kind === "existing"
              ? option.label
              : types.length > 1
                ? COPY.addAs(option.name, option.type)
                : COPY.add(option.name)}
          </Text>
        )}
        onChange={onChange}
        getKey={(o) =>
          o.kind === "existing" ? `existing:${o.id}` : `new:${o.type}`
        }
        getLabel={(o) => o.label}
      />
    );
  }

  const canEdit = value.kind === "existing" || commit !== undefined;

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
    router.push(`${entityBasePath(target.type)}/${target.id}`);
  }

  // Someone this field wrote goes with their relationship, and an unpublished
  // one with it; anyone else is only let go of.
  async function remove() {
    if (
      value?.kind === "existing" &&
      value.addedHere === true &&
      value.relationshipId !== undefined
    )
      await core.relationships.softDelete(value.relationshipId);
    onChange(null);
  }

  const run = (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    work()
      .catch((e: unknown) => Alert.alert(failure, String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.rowMeta}>
        <Text style={styles.fieldValue}>{value.label}</Text>
        <View style={styles.rowActions}>
          {canEdit && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => run(edit, COPY.editFailed)}
            >
              <Text style={styles.link}>{COPY.edit}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => run(remove, COPY.removeFailed)}
          >
            <Text style={styles.link}>{COPY.remove}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
