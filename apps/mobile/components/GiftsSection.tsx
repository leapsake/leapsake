import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GiftForRecipient } from "@leapsake/core";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { colors, styles } from "../lib/styles";

/**
 * The "Gifts" section on a Person or Pet screen, ported from the desktop
 * `GiftsSection`. One list of what they are down for, outstanding first and given
 * ones sunk, so the section reads as a shopping list for this person.
 *
 * Read-only, like the rest of the page: adding a gift, ticking one off and
 * dropping one all happen on the form behind the page's Edit
 * ({@link StagedGiftsSection}). What remains here is what the list is *for* —
 * reading what to get somebody, and the idea's own page, where its title and link
 * live because they belong to the idea rather than to any one recipient.
 */
export function GiftsSection({ gifts }: { gifts: GiftForRecipient[] }) {
  const ordered = sortGiftsGivenLast(gifts, (row) => row.ideaTitle);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
      </View>

      {ordered.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : (
        ordered.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{isGiven(row) ? "✓" : "○"}</Text>
              <Link href={`/gifts/${row.giftIdeaId}/edit`}>
                <Text style={[styles.rowText, { color: colors.accent }]}>
                  {row.ideaTitle}
                </Text>
              </Link>
            </View>
            {row.ideaUrl !== null && <GiftLink url={row.ideaUrl} />}
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
