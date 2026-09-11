import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import {
  type EntityType,
  type RelationshipNeighbor,
  baseRole,
} from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The role shown for a neighbor: a free-text note for "other", else the label. */
function roleText(neighbor: RelationshipNeighbor): string {
  return neighbor.otherRole === "other" && neighbor.otherRoleNote
    ? neighbor.otherRoleNote
    : neighbor.otherRoleLabel;
}

/** How a row is addressed: a stored id, or the triple a dismissal is keyed on. */
function keyOf(neighbor: RelationshipNeighbor): string {
  return neighbor.origin === "explicit"
    ? neighbor.relationshipId
    : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
}

/**
 * The Relationships section on the Person and Pet detail screens, ported from the
 * desktop `RelationshipsSection`. It lists the subject's neighbors — both stored
 * (explicit) edges and the ones the inference engine computes (derived) — already
 * oriented + labelled by the view layer and presented uniformly: each row names
 * who and how, links to them, and carries **Edit** and **Remove**.
 *
 * **The explicit/derived difference is invisible until you act on a row**, which
 * is the right place for it: as a fact about the subject, "Ruth is my sister" is
 * one thing however the app came to know it. Then the two part company —
 *
 * - **Editing** a stored edge re-roles it (`editFromSubject`). Editing a derived
 *   one *materialises* it: there is no row to change, so saving writes the edge
 *   the inference was standing in for. Both keep the other end fixed, because
 *   an endpoint is not a thing either write can move.
 * - **Removing** a stored edge deletes it. A derived one has nothing to delete
 *   and is **dismissed** instead — a remembered "no, they aren't", which is what
 *   stops the engine proposing it again. Each says which it is about to do.
 *
 * Only a stored edge has a page of its own, so only a stored row offers
 * **Details**; a derived one is an inference, with nothing else to show.
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
  /** Refetch the page — a removal writes in place, with nowhere to navigate to. */
  onChanged: () => void;
}) {
  const core = useCore();
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  /**
   * Where **Edit** goes. A stored edge has a route keyed on its id; a derived
   * one has no id, so it goes to the add route with the pair and the role it was
   * inferred with — the same screen, opening on what is already true, and saving
   * turns it into a stored edge.
   */
  function editHref(neighbor: RelationshipNeighbor): string {
    if (neighbor.origin === "explicit") {
      return `${basePath}/relationships/${neighbor.relationshipId}/edit`;
    }
    // Assembled by hand rather than with `URLSearchParams`, whose `toString`
    // React Native's URL shim does not implement. Every value here is an id or
    // an enum, so encoding is belt-and-braces.
    const query = [
      `otherType=${encodeURIComponent(neighbor.otherType)}`,
      `otherId=${encodeURIComponent(neighbor.otherId)}`,
      `otherRole=${encodeURIComponent(neighbor.otherRole)}`,
    ].join("&");
    return `${basePath}/relationships/new?${query}`;
  }

  function confirmRemove(neighbor: RelationshipNeighbor) {
    const label = neighbor.otherLabel;
    // Three removals wearing one word, and the user is told which they are
    // getting while it can still be reconsidered.
    const message =
      neighbor.origin === "derived"
        ? `${label} is worked out from your other relationships. Removing it records that they aren't, so it won't come back.`
        : neighbor.otherStanding === "unpublished"
          ? `${label} is only recorded here, so removing this will remove them too.`
          : `Remove ${label}?`;

    const remove = () =>
      neighbor.origin === "explicit"
        ? core.relationships.softDelete(neighbor.relationshipId)
        : core.kinship.dismiss(
            subjectType,
            subjectId,
            neighbor.otherType,
            neighbor.otherId,
            baseRole(neighbor.otherRole),
          );

    Alert.alert("Remove relationship", message, [
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
    ]);
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
          const otherPath = `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
          return (
            <View key={keyOf(neighbor)} style={styles.row}>
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
                    accessibilityLabel={`Remove ${neighbor.otherLabel}`}
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
