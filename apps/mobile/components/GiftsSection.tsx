import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import { formatGiftDate, formatGiftTargetDate } from "@leapsake/schema";
import { groupGiftsByIdea } from "@leapsake/view-models";
import { colors, styles } from "../lib/styles";

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

/**
 * The "Gifts" section on a Person or Pet screen, ported from the desktop
 * `GiftsSection`. One list combining **suggestions** (candidates) and **givings**
 * (dated events), grouped by idea. A giving points at the idea, never the
 * suggestion, so "✓ given" is just a fact read alongside (the suggestion row never
 * changes state); candidates not yet given lead, given ideas sink.
 *
 * Read-only, like the rest of the page: capturing a gift, re-dating one and
 * dropping one all happen on the form behind the page's Edit
 * ({@link StagedGiftsSection}). What remains here is what the list is *for* —
 * reading what to get somebody, and the idea's own page, where its title and link
 * live because they belong to the idea rather than to any one recipient.
 */
export function GiftsSection({
  suggestions,
  gifts,
}: {
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
}) {
  // Suggestions + givings unioned into one entry per idea, candidates leading.
  const ordered = groupGiftsByIdea<
    GiftSuggestionForRecipient,
    GiftForRecipient
  >(suggestions, gifts);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
      </View>

      {ordered.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : (
        ordered.map((group) => (
          <View key={group.ideaId} style={styles.row}>
            <Link href={`/gifts/${group.ideaId}/edit`}>
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {group.title}
              </Text>
            </Link>
            {group.url !== null && <GiftLink url={group.url} />}

            {group.suggestions.map((s) => {
              const target = formatGiftTargetDate(s);
              const bits = joinBits([
                s.occasionLabel,
                target === "" ? null : target,
              ]);
              return (
                <Text key={s.id} style={styles.muted}>
                  Suggested{bits === "" ? "" : ` — ${bits}`}
                </Text>
              );
            })}

            {group.gifts.map((g) => {
              const when = formatGiftDate(g);
              const bits = joinBits([
                when === "" ? null : when,
                g.giverLabel !== null ? `from ${g.giverLabel}` : null,
                g.occasionLabel,
              ]);
              return (
                <Text key={g.id} style={styles.muted}>
                  ✓ Given{bits === "" ? "" : ` — ${bits}`}
                </Text>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * An idea's link, opened in the device browser — the mobile stand-in for the
 * desktop row's `<a target="_blank">`. A URL the OS can't open (a typo, a scheme
 * with no handler) surfaces as an alert rather than failing silently.
 */
export function GiftLink({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        Linking.openURL(url).catch(() =>
          Alert.alert("Couldn't open link", url),
        );
      }}
    >
      <Text style={styles.link} numberOfLines={1}>
        {url}
      </Text>
    </Pressable>
  );
}
