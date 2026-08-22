import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GiftForRecipient } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { partyKey } from "@leapsake/ui/headless";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { colors, styles } from "../lib/styles";
import { useCore } from "../lib/core-context";

/**
 * The "Gifts" section on a Person or Pet screen, ported from the desktop
 * `GiftsSection`. One list of what they are down for, outstanding first and given
 * ones sunk, so the section reads as a shopping list for this person.
 *
 * **The tick writes where it stands**, like its counterpart on the idea's own
 * page ({@link GiftIdeaRecipientsSection}) — a link is ticked or it isn't, so
 * there is no half-state to hold back and nothing a Save would add. It is the
 * ✓/○ the row already showed, now the control rather than a report of one:
 * ticking a gift off is the single commonest thing anybody does to this list,
 * and it should not cost a screen.
 *
 * Adding pushes the capture screen with this recipient already settled, because
 * a gift is an *idea* plus who it suits, and the idea has a title, a URL and a
 * pool to autocomplete against that belong to `/gifts/new`. Removing unlinks the
 * idea from this recipient; the idea itself carries on existing for anybody
 * else, which is why the confirm says so.
 *
 * The idea's own page is still where its title and link are changed — those
 * belong to the idea rather than to any one recipient.
 */
export function GiftsSection({
  recipientType,
  recipientId,
  gifts,
  onChanged,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  gifts: GiftForRecipient[];
  /** Refetch the page — the tick and the removal both write in place. */
  onChanged: () => void;
}) {
  const core = useCore();
  const ordered = sortGiftsGivenLast(gifts, (row) => row.ideaTitle);

  function setGiven(row: GiftForRecipient, given: boolean) {
    core.gifts.recipients.update(row.id, { given }).then(
      () => onChanged(),
      (e: unknown) => Alert.alert("Couldn't save", String(e)),
    );
  }

  function confirmRemove(row: GiftForRecipient) {
    Alert.alert("Remove gift", `Stop listing ${row.ideaTitle} for them?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          core.gifts.recipients.softDelete(row.id).then(
            () => onChanged(),
            (e: unknown) => Alert.alert("Couldn't remove", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
        <Link
          href={`/gifts/new?recipient=${partyKey({ type: recipientType, id: recipientId })}`}
          style={styles.link}
        >
          Add gift
        </Link>
      </View>

      {ordered.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : (
        ordered.map((row) => {
          const given = isGiven(row);
          return (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowMeta}>
                <View style={styles.rowWithLead}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: given }}
                    accessibilityLabel={`${row.ideaTitle} — ${given ? "given" : "not given yet"}`}
                    hitSlop={12}
                    onPress={() => setGiven(row, !given)}
                  >
                    <Text style={styles.muted}>{given ? "✓" : "○"}</Text>
                  </Pressable>
                  <Link href={`/gifts/${row.giftIdeaId}/edit`}>
                    <Text style={[styles.rowText, { color: colors.accent }]}>
                      {row.ideaTitle}
                    </Text>
                  </Link>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.ideaTitle}`}
                  onPress={() => confirmRemove(row)}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
              {row.ideaUrl !== null && <GiftLink url={row.ideaUrl} />}
            </View>
          );
        })
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
