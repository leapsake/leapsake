import { useCallback } from "react";
import { FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { TagListItem } from "@leapsake/core";
import { tagLabel } from "@leapsake/schema";
import { useCore } from "../../lib/core-context";
import { tagHref } from "../../lib/record-title";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";
import { LoadState } from "../../components/LoadState";

// Every tag in use, alphabetically. None is created here: a tag exists only
// while something wears it.
export default function TagsScreen() {
  const core = useCore();
  const load = useCallback(() => core.tags.list(), [core]);
  const { data, error } = useFocusedData(load);

  return (
    <>
      {error !== null || data === null ? (
        <LoadState error={error} />
      ) : (
        <FlatList<TagListItem>
          contentContainerStyle={styles.screen}
          data={data}
          keyExtractor={(tag) => tag.id}
          ListEmptyComponent={
            <Text style={styles.muted}>
              No tags yet. Tags appear here once you add one to a person, pet,
              reminder, or gift idea.
            </Text>
          }
          renderItem={({ item: tag }) => (
            /* `Link` renders a `Text`, and iOS drops a view nested in text from
               the accessibility tree; one label restores the row. */
            <Link
              href={tagHref(tag)}
              style={styles.row}
              accessible
              accessibilityLabel={`${tagLabel(tag.name)}, ${
                tag.usageCount === 1 ? "1 item" : `${tag.usageCount} items`
              }`}
            >
              <View>
                <Text style={[styles.rowText, { color: colors.accent }]}>
                  {tagLabel(tag.name)}
                </Text>
                <Text style={styles.rowMeta}>
                  {tag.usageCount === 1 ? "1 item" : `${tag.usageCount} items`}
                </Text>
              </View>
            </Link>
          )}
        />
      )}
    </>
  );
}
