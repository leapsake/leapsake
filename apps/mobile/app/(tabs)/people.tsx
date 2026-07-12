import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

// The combined "People & Pets" list, ported from desktop's EntityList. People
// and pets share one alphabetical list, and both row types navigate to their
// own detail page. The muted "(pet)" suffix keeps the two entity types visually
// distinguishable in the shared list. This screen's title and "Add" actions live
// on the tab navigator (app/(tabs)/_layout.tsx), which owns this tab's header.
export default function PeoplePetsScreen() {
  const core = useCore();
  const load = useCallback(() => core.views.entityList(), [core]);
  const { data: entities, error } = useFocusedData(load);

  return (
    <View style={styles.screen}>
      {error !== null ? (
        <Text style={styles.danger}>{error}</Text>
      ) : entities === null ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={entities}
          keyExtractor={(entity) => `${entity.type}:${entity.id}`}
          ListHeaderComponent={
            <Link href="/duplicates" style={[styles.row, styles.link]}>
              Review duplicates
            </Link>
          }
          ListEmptyComponent={
            <Text style={styles.muted}>Nobody here yet.</Text>
          }
          renderItem={({ item }) => <EntityListRow entity={item} />}
        />
      )}
    </View>
  );
}

function EntityListRow({ entity }: { entity: EntityRow }) {
  if (entity.type === "person") {
    return (
      <Link href={`/people/${entity.id}`} style={styles.row}>
        <Text style={[styles.rowText, { color: colors.accent }]}>
          {entity.label}
        </Text>
      </Link>
    );
  }
  return (
    <Link href={`/pets/${entity.id}`} style={styles.row}>
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {entity.label} <Text style={styles.muted}>(pet)</Text>
      </Text>
    </Link>
  );
}
