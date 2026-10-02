import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { EmptyState } from "../../components/EmptyState";
import { useCore } from "../../lib/core-context";
import { entityRowHref } from "../../lib/record-title";
import { useFocusedData } from "../../lib/useFocusedData";
import { useHeaderScroll } from "../../lib/use-header-scroll";
import { colors, styles } from "../../lib/styles";

// People and pets in one alphabetical list, a pet's row marked "(pet)". Its
// title and header actions are declared with the bar in `(tabs)/_layout.tsx`.
export default function PeoplePetsScreen() {
  const core = useCore();

  const load = useCallback(
    () =>
      Promise.all([
        core.views.entityList(),
        core.self.get(),
        // The review link shows only when there are duplicates, with the count.
        core.duplicates.count(),
      ]),
    [core],
  );
  const { data, error } = useFocusedData(load);
  const scrollProps = useHeaderScroll();
  const [entities, self, duplicateCount] = data ?? [null, undefined, 0];

  return (
    <View style={styles.screen}>
      {error !== null ? (
        <Text style={styles.danger}>{error}</Text>
      ) : entities === null ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          {...scrollProps}
          // Grown so an empty list can centre its message and its two ways in.
          contentContainerStyle={styles.listContent}
          data={entities}
          keyExtractor={(entity) => `${entity.type}:${entity.id}`}
          ListHeaderComponent={
            duplicateCount > 0 ? (
              <Link href="/duplicates" style={[styles.row, styles.link]}>
                Review {duplicateCount} possible{" "}
                {duplicateCount === 1 ? "duplicate" : "duplicates"}
              </Link>
            ) : null
          }
          ListEmptyComponent={
            // Import first, which has no header action: the bigger win on a
            // first run. A pet last, as the rarer case.
            <EmptyState
              message="Nobody here yet."
              actions={[
                {
                  href: "/import",
                  label: "Import contacts",
                  glyph: "📇",
                },
                { href: "/add", label: "Add a person", glyph: "👤" },
                { href: "/add?type=pet", label: "Add a pet", glyph: "🐾" },
              ]}
            />
          }
          renderItem={({ item }) => (
            <EntityListRow
              entity={item}
              isSelf={item.type === "person" && item.id === self?.personId}
            />
          )}
        />
      )}
    </View>
  );
}

/** One row, a link to its page and nothing else; the self-person wears
 *  a "(You)" badge. */
function EntityListRow({
  entity,
  isSelf,
}: {
  entity: EntityRow;
  isSelf: boolean;
}) {
  if (entity.type === "person") {
    return (
      <Link href={entityRowHref(entity)} style={styles.row}>
        <Text style={[styles.rowText, { color: colors.accent }]}>
          {entity.label} {isSelf && <Text style={styles.muted}>(You)</Text>}
        </Text>
      </Link>
    );
  }
  return (
    <Link href={entityRowHref(entity)} style={styles.row}>
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {entity.label} <Text style={styles.muted}>(pet)</Text>
      </Text>
    </Link>
  );
}
