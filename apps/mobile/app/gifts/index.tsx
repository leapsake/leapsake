import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import type { GiftIdeaOverview } from "@leapsake/core";
import {
  formatGiftDate,
  formatGiftTargetDate,
  tagLabel,
} from "@leapsake/schema";
import { sortIdeasGivenLast } from "@leapsake/view-models";
import { EmptyState } from "../../components/EmptyState";
import { GiftLink } from "../../components/GiftsSection";
import { SearchHereLink } from "../../components/SearchHereLink";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

/**
 * The Gifts catalog — the whole gift graph keyed by idea, ported from desktop's
 * `GiftList`. Each idea shows its tags, notes, who it's **suggested** for and
 * every **giving** of it. Creating is its own screen (the "+ Add" header action
 * below), so this stays a plain list — the People & Pets pattern. Tapping an idea
 * opens its edit screen, which also manages who it's suggested for.
 *
 * A root-stack screen rather than a tab: it's the cross-recipient shopping list
 * you consult, not a place you live. It's reached from Search's browse list —
 * and, per recipient, from the `GiftsSection` on a person's or pet's page. This
 * screen owns its own header, which the tab navigator used to.
 */
export default function GiftsScreen() {
  const core = useCore();
  const load = useCallback(() => core.gifts.overview(), [core]);
  const { data, error } = useFocusedData(load);

  // Ideas already given sink to the bottom, keeping the shopping list on top.
  const ordered = data === null ? null : sortIdeasGivenLast(data);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Gifts",
          headerRight: () => (
            <View style={styles.headerActions}>
              <SearchHereLink category="gifts" />
              <Link href="/gifts/new" style={styles.link}>
                + Add
              </Link>
            </View>
          ),
        }}
      />
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
          renderItem={({ item: { idea, tags, suggestions, gifts } }) => (
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

              {suggestions.map((s) => {
                const target = formatGiftTargetDate(s);
                const bits = joinBits([
                  s.occasionLabel,
                  target === "" ? null : target,
                ]);
                return (
                  <Text key={s.id} style={styles.muted}>
                    Suggested for {s.recipientLabel}
                    {bits === "" ? "" : ` — ${bits}`}
                  </Text>
                );
              })}
              {gifts.map((g) => {
                const when = formatGiftDate(g);
                const bits = joinBits([
                  when === "" ? null : when,
                  g.giverLabel !== null ? `from ${g.giverLabel}` : null,
                  g.occasionLabel,
                ]);
                return (
                  <Text key={g.id} style={styles.muted}>
                    ✓ Given to {g.recipientLabel}
                    {bits === "" ? "" : ` — ${bits}`}
                  </Text>
                );
              })}
            </View>
          )}
        />
      )}
    </>
  );
}
