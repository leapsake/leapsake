import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GiftIdeaOverview } from "@leapsake/core";
import {
  formatGiftDate,
  formatGiftTargetDate,
  tagLabel,
} from "@leapsake/schema";
import { GiftLink } from "../../components/GiftsSection";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

/**
 * The Gifts tab — the whole gift graph keyed by idea, ported from desktop's
 * `GiftList`. Each idea shows its tags, notes, who it's **suggested** for and
 * every **giving** of it. Creating is its own screen (the "+ Add" header action,
 * app/(tabs)/_layout.tsx), so this stays a plain list — the People & Pets pattern.
 * Tapping an idea opens its edit screen, which also manages who it's suggested for.
 */
export default function GiftsScreen() {
  const core = useCore();
  const load = useCallback(() => core.gifts.overview(), [core]);
  const { data, error } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }

  if (data === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  // Ideas already given sink to the bottom, keeping the shopping list on top —
  // the same posture the Person/Pet Gifts section takes. Nothing is hidden: an
  // idea given once is still a fine idea
  // to give again, and filtering would strand it. Within each half the repo's
  // newest-first order stands.
  const ordered = [...data].sort(
    (a, b) => (a.gifts.length > 0 ? 1 : 0) - (b.gifts.length > 0 ? 1 : 0),
  );

  return (
    <FlatList<GiftIdeaOverview>
      contentContainerStyle={styles.screen}
      data={ordered}
      keyExtractor={(row) => row.idea.id}
      ListEmptyComponent={<Text style={styles.muted}>No gifts yet.</Text>}
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
  );
}
