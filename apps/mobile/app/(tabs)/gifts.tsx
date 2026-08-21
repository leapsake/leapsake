import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GiftIdeaOverview } from "@leapsake/core";
import { tagLabel } from "@leapsake/schema";
import { isGiven, sortIdeasGivenLast } from "@leapsake/view-models";
import { EmptyState } from "../../components/EmptyState";
import { GiftLink } from "../../components/GiftsSection";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

/**
 * The Gifts catalog — the whole gift graph keyed by idea, ported from desktop's
 * `GiftList`. Each idea shows its tags, notes, and everyone it is for, ticked or
 * not. Creating is its own screen, reached with the **New** tab from here, so
 * this stays a plain list — the People & Pets pattern. Tapping an idea opens its
 * edit screen, which also manages who it is for.
 *
 * A hidden member of the tab navigator rather than a tab: it's the
 * cross-recipient shopping list you consult, not a place you live, so it earns
 * the bar under it but not a button on it. It's reached from Search's browse
 * list — and, per recipient, from the `GiftsSection` on a person's or pet's
 * page. Its title and header actions are declared with the bar itself, in
 * `app/(tabs)/_layout.tsx`.
 */
export default function GiftsScreen() {
  const core = useCore();
  const load = useCallback(() => core.gifts.overview(), [core]);
  const { data, error } = useFocusedData(load);

  // An idea everyone on it already has sinks to the bottom, keeping the shopping
  // list on top.
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
              actions={[{ href: "/gifts/new", label: "+ Add a gift idea" }]}
            />
          }
          renderItem={({ item: { idea, tags, recipients } }) => (
            <View style={styles.row}>
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
          )}
        />
      )}
    </>
  );
}
