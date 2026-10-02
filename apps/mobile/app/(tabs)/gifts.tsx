import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GiftIdeaOverview } from "@leapsake/core";
import { tagLabel } from "@leapsake/schema";
import { isGiven, sortIdeasGivenLast } from "@leapsake/view-models";
import { EmptyState } from "../../components/EmptyState";
import { GiftThumbnail } from "../../components/GiftImage";
import { GiftLink } from "../../components/GiftsSection";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

/** Every gift idea, with its tags, notes and everyone it is for. */
export default function GiftsScreen() {
  const core = useCore();
  const load = useCallback(() => core.gifts.overview(), [core]);
  const { data, error } = useFocusedData(load);

  // An idea everyone on it already has sinks, keeping the shopping list on top.
  const ordered = data === null ? null : sortIdeasGivenLast(data);

  return (
    <>
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : ordered === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList<GiftIdeaOverview>
          contentContainerStyle={styles.screen}
          data={ordered}
          keyExtractor={(row) => row.idea.id}
          ListEmptyComponent={
            <EmptyState
              message="No gifts yet."
              actions={[
                { href: "/gifts/new", label: "Add a gift idea", glyph: "🎁" },
              ]}
            />
          }
          renderItem={({ item: { idea, tags, recipients } }) => (
            <View style={[styles.row, styles.rowWithLead]}>
              <GiftThumbnail uri={idea.imageUrl} />
              <View style={{ flex: 1 }}>
                <Link href={`/gifts/${idea.id}/edit`}>
                  <Text style={[styles.rowText, { color: colors.accent }]}>
                    {idea.title}
                  </Text>
                </Link>

                {tags.length > 0 && (
                  <Text style={styles.fieldLabel}>
                    {tags.map((tag) => tagLabel(tag.name)).join(" ")}
                  </Text>
                )}
                {idea.notes !== null && (
                  <Text style={styles.muted}>{idea.notes}</Text>
                )}
                {idea.url !== null && <GiftLink url={idea.url} />}

                {recipients.map((row) => (
                  <Text key={row.id} style={styles.muted}>
                    {isGiven(row) ? "✓ Given to" : "For"} {row.recipientLabel}
                  </Text>
                ))}
              </View>
            </View>
          )}
        />
      )}
    </>
  );
}
