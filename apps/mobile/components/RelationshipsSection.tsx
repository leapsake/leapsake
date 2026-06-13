import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import {
  type EntityType,
  type RelationshipNeighbor,
  baseRole,
} from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The route base for an entity's pages, branching on its type. */
function basePathFor(type: EntityType, id: string): string {
  return `/${type === "person" ? "people" : "pets"}/${id}`;
}

/** The role shown for a neighbor: a free-text note for "other", else the label. */
function roleText(neighbor: RelationshipNeighbor): string {
  return neighbor.otherRole === "other" && neighbor.otherRoleNote
    ? neighbor.otherRoleNote
    : neighbor.otherRoleLabel;
}

/**
 * The Relationships section shared by the Person and Pet detail screens, ported
 * from the desktop `RelationshipsSection`. It lists the subject's neighbors —
 * both stored (explicit) edges and the ones the inference engine computes
 * (derived) — already oriented + labelled by the view layer and presented
 * uniformly: the explicit/derived distinction is a backend detail. Each row's
 * actions branch on origin: an explicit edge opens its detail page, edits by id,
 * and soft-deletes; a derived edge has no id, so editing it navigates to the add
 * screen pre-pointed at the other endpoint (which materialises a stored edge),
 * and removing it records a dismissal via `core.kinship.dismiss`.
 *
 * Remove confirms with a native `Alert` then calls `onChanged` so the detail
 * screen refetches its view — mirroring `MilestonesSection`.
 */
export function RelationshipsSection({
  subjectType,
  subjectId,
  relationships,
  onChanged,
}: {
  subjectType: EntityType;
  subjectId: string;
  relationships: RelationshipNeighbor[];
  onChanged: () => void;
}) {
  const core = useCore();
  const basePath = basePathFor(subjectType, subjectId);

  function confirmRemove(neighbor: RelationshipNeighbor) {
    const remove =
      neighbor.origin === "explicit"
        ? () => core.relationships.softDelete(neighbor.relationshipId)
        : () =>
            core.kinship.dismiss(
              subjectType,
              subjectId,
              neighbor.otherType,
              neighbor.otherId,
              baseRole(neighbor.otherRole),
            );
    Alert.alert(
      "Remove relationship",
      `Remove ${neighbor.otherLabel} (${roleText(neighbor)})? This does not delete ${neighbor.otherLabel}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            remove().then(
              () => onChanged(),
              (e: unknown) => Alert.alert("Couldn't remove", String(e)),
            );
          },
        },
      ],
    );
  }

  // A derived edge has no stored id, so editing it materialises a new explicit
  // edge: the add screen receives the fixed other endpoint + current base role.
  function editHref(neighbor: RelationshipNeighbor): string {
    if (neighbor.origin === "explicit") {
      return `${basePath}/relationships/${neighbor.relationshipId}/edit`;
    }
    const query = new URLSearchParams({
      otherType: neighbor.otherType,
      otherId: neighbor.otherId,
      otherRole: baseRole(neighbor.otherRole),
    }).toString();
    return `${basePath}/relationships/new?${query}`;
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Relationships</Text>
        <Link href={`${basePath}/relationships/new`} style={styles.link}>
          Add relationship
        </Link>
      </View>

      {relationships.length === 0 ? (
        <Text style={styles.muted}>No relationships yet.</Text>
      ) : (
        relationships.map((neighbor) => {
          const otherPath = basePathFor(neighbor.otherType, neighbor.otherId);
          const key =
            neighbor.origin === "explicit"
              ? neighbor.relationshipId
              : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
          return (
            <View key={key} style={styles.row}>
              <Link href={otherPath} style={styles.rowText}>
                {neighbor.otherLabel}
              </Link>
              <View style={styles.rowMeta}>
                <Text style={styles.muted}>{roleText(neighbor)}</Text>
                <View style={styles.rowActions}>
                  {neighbor.origin === "explicit" ? (
                    <Link
                      href={`/relationships/${neighbor.relationshipId}`}
                      style={styles.link}
                    >
                      Details
                    </Link>
                  ) : null}
                  <Link href={editHref(neighbor)} style={styles.link}>
                    Edit
                  </Link>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => confirmRemove(neighbor)}
                  >
                    <Text style={[styles.link, styles.danger]}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
