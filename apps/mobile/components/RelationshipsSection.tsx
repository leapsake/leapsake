import { Alert, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import {
  type EntityType,
  type RelationshipNeighbor,
  baseRole,
} from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { RowMenu, rowMenuItem } from "./RowMenu";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A neighbor's role: the free-text note for "other", else the label. */
function roleText(neighbor: RelationshipNeighbor): string {
  return neighbor.otherRole === "other" && neighbor.otherRoleNote
    ? neighbor.otherRoleNote
    : neighbor.otherRoleLabel;
}

/** A row's key: a stored id, or the triple a dismissal is keyed on. */
function keyOf(neighbor: RelationshipNeighbor): string {
  return neighbor.origin === "explicit"
    ? neighbor.relationshipId
    : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
}

/**
 * Stored and derived neighbors alike. Edit re-roles a stored edge or
 * materialises a derived one; Remove deletes one or dismisses the other.
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
  /** Refetch the page after a removal, which has nowhere to navigate to. */
  onChanged: () => void;
}) {
  const core = useCore();
  const router = useRouter();
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  /** A stored edge's own route, or the add route opening on the inference. */
  function editHref(neighbor: RelationshipNeighbor): string {
    if (neighbor.origin === "explicit") {
      return `${basePath}/relationships/${neighbor.relationshipId}/edit`;
    }
    // By hand: React Native's URL shim lacks `URLSearchParams.toString`.
    const query = [
      `otherType=${encodeURIComponent(neighbor.otherType)}`,
      `otherId=${encodeURIComponent(neighbor.otherId)}`,
      `otherRole=${encodeURIComponent(neighbor.otherRole)}`,
    ].join("&");
    return `${basePath}/relationships/new?${query}`;
  }

  function confirmRemove(neighbor: RelationshipNeighbor) {
    const label = neighbor.otherLabel;
    // Three removals share one word, so the confirm says which this is.
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
                <RowMenu
                  subject={neighbor.otherLabel}
                  items={[
                    ...(neighbor.origin === "explicit"
                      ? [
                          rowMenuItem.details(() =>
                            router.push(
                              `/relationships/${neighbor.relationshipId}`,
                            ),
                          ),
                        ]
                      : []),
                    rowMenuItem.edit(() => router.push(editHref(neighbor))),
                    rowMenuItem.remove(() => confirmRemove(neighbor)),
                  ]}
                />
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
