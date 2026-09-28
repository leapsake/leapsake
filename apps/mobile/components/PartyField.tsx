import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { RelationshipCandidate } from "@leapsake/core";
import type { EntityType } from "@leapsake/schema";
import {
  type CommittedParty,
  type NewParty,
  type PartyChoice,
  entityBasePath,
  usePartyField,
} from "@leapsake/ui/headless";
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
  commit?: (party: NewParty) => Promise<CommittedParty>;
  testID?: string;
}) {
  const core = useCore();
  const router = useRouter();
  const { canEdit, busy, edit, remove } = usePartyField({
    value,
    onChange,
    commit,
    open: (party) => router.push(`${entityBasePath(party.type)}/${party.id}`),
    removeRelationship: (id) => core.relationships.softDelete(id),
    onFailure: (action, e) =>
      Alert.alert(
        action === "edit" ? COPY.editFailed : COPY.removeFailed,
        String(e),
      ),
  });

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

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.rowMeta}>
        <Text style={styles.fieldValue}>{value.label}</Text>
        <View style={styles.rowActions}>
          {canEdit && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy }}
              onPress={() => void edit()}
            >
              <Text style={styles.link}>{COPY.edit}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy }}
            onPress={() => void remove()}
          >
            <Text style={styles.link}>{COPY.remove}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
