import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { useCore } from "../lib/core-context";
import { useFocusedData } from "../lib/useFocusedData";
import { colors, styles } from "../lib/styles";

// The combined "People & Pets" home, ported from desktop's EntityList. People
// and pets share one alphabetical list. Person rows navigate to their detail
// page; pet rows are plain text for now — pet screens land in a later increment,
// so this avoids dead links while keeping the home honest.
export default function HomeScreen() {
  const core = useCore();
  const load = useCallback(() => core.views.entityList(), [core]);
  const { data: entities, error } = useFocusedData(load);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: "People & Pets",
          headerRight: () => (
            <Link href="/people/new" style={styles.link}>
              Add person
            </Link>
          ),
        }}
      />

      {error !== null ? (
        <Text style={styles.danger}>{error}</Text>
      ) : entities === null ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={entities}
          keyExtractor={(entity) => `${entity.type}:${entity.id}`}
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
    <View style={styles.row}>
      <Text style={styles.rowText}>
        {entity.label} <Text style={styles.muted}>(pet)</Text>
      </Text>
    </View>
  );
}
