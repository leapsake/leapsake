import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { TagListItem } from "@leapsake/core";
import { tagLabel } from "@leapsake/schema";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

// The tag catalog: every tag in use, alphabetically, each row opening the tag's
// page (everything wearing it). A catalog like Holidays and Gifts — a hidden
// member of the tab navigator reached from Search's browse list, keeping the bar
// under it without a button of its own. Its title and "Search" link are declared
// with the bar, in `app/(tabs)/_layout.tsx`.
//
// It earns a place next to those two for the same reason: tags are created
// inline, scattered across people, pets, reminders, and gift ideas, so without
// this there is nowhere to see what tags you actually have. Search finds a tag
// you can already name; this is for the ones you can't.
//
// Tags aren't created here — a tag exists only because something wears it (the
// repo garbage-collects a tag the moment its last tagging goes), so there's no
// "New tag" affordance to offer.
export default function TagsScreen() {
  const core = useCore();
  const load = useCallback(() => core.tags.list(), [core]);
  const { data, error } = useFocusedData(load);

  return (
    <>
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : data === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
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
            <Link href={`/tags/${tag.id}`} style={styles.row}>
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
