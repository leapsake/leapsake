import { Text, View } from "react-native";
import { Link } from "expo-router";
import { type RelationshipNeighbor, baseRole } from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { styles } from "../lib/styles";

/** The role shown for a neighbor: a free-text note for "other", else the label. */
function roleText(neighbor: RelationshipNeighbor): string {
  return neighbor.otherRole === "other" && neighbor.otherRoleNote
    ? neighbor.otherRoleNote
    : neighbor.otherRoleLabel;
}

/**
 * The Relationships section on the Person and Pet detail screens, ported from the
 * desktop `RelationshipsSection`. It lists the subject's neighbors — both stored
 * (explicit) edges and the ones the inference engine computes (derived) — already
 * oriented + labelled by the view layer and presented uniformly: the
 * explicit/derived distinction is a backend detail.
 *
 * Read-only, like every section on these screens: each row names who and how, and
 * links to them and (for a stored edge) to the relationship's own page. Adding,
 * re-roling, removing and dismissing all moved to the form behind the page's one
 * Edit ({@link StagedRelationshipsSection}), which is also where the
 * explicit/derived difference finally shows itself — in what saving a change to
 * one does.
 */
export function RelationshipsSection({
  relationships,
}: {
  relationships: RelationshipNeighbor[];
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Relationships</Text>
      </View>

      {relationships.length === 0 ? (
        <Text style={styles.muted}>No relationships yet.</Text>
      ) : (
        relationships.map((neighbor) => {
          const otherPath = `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
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
                {/* Only a stored edge has a page: a derived one is an inference,
                    with nothing of its own to show. */}
                {neighbor.origin === "explicit" ? (
                  <Link
                    href={`/relationships/${neighbor.relationshipId}`}
                    style={styles.link}
                  >
                    Details
                  </Link>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
