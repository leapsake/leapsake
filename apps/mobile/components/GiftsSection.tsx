import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import type { GiftForRecipient } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { partyKey } from "@leapsake/ui/headless";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { colors, styles } from "../lib/styles";
import { useCore } from "../lib/core-context";
import { RowMenu, rowMenuItem } from "./RowMenu";
import { RecordSection } from "./RecordSection";

/**
 * What someone is down for, given ones last. The tick writes where it stands;
 * Remove unlinks the idea from them, and the idea lives on.
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
  const router = useRouter();
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
    <RecordSection
      title="Gifts"
      link={{
        href: `/gifts/new?recipient=${partyKey({ type: recipientType, id: recipientId })}`,
        what: "gift",
        action: "add",
      }}
      isEmpty={ordered.length === 0}
      emptyText="No gifts yet."
    >
      {ordered.map((row) => {
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
              <RowMenu
                subject={row.ideaTitle}
                items={[
                  rowMenuItem.edit(() =>
                    router.push(`/gifts/${row.giftIdeaId}/edit`),
                  ),
                  rowMenuItem.remove(() => confirmRemove(row)),
                ]}
              />
            </View>
            {row.ideaUrl !== null && <GiftLink url={row.ideaUrl} />}
          </View>
        );
      })}
    </RecordSection>
  );
}

/** An idea's link in the browser; one the OS cannot open raises an alert. */
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
