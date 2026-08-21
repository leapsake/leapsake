import { Alert, Pressable, Switch, Text, View } from "react-native";
import type { GiftForIdea } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { partyKey } from "@leapsake/ui/headless";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { Typeahead } from "./Typeahead";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A person/pet the idea can be for — the add field's pool. */
export interface RecipientCandidate {
  type: GiftPartyType;
  id: string;
  label: string;
}

/**
 * The "For…" section on a gift idea's edit screen, ported from the desktop
 * `GiftIdeaRecipientsSection` — the idea end of the same link a person's "Gifts"
 * section shows from the other side. Adding someone here writes the row their
 * page would; ticking the switch here is the tick they would see.
 *
 * Each row used to open an occasion/target-date editor behind an Edit. Occasion
 * and date were the only things it edited, so with those gone the row's whole
 * state is its switch, and it sits in the row rather than behind anything.
 */
export function GiftIdeaRecipientsSection({
  ideaId,
  recipients,
  candidates,
  onChanged,
}: {
  ideaId: string;
  recipients: GiftForIdea[];
  candidates: RecipientCandidate[];
  onChanged: () => void;
}) {
  const core = useCore();

  // Parties already on this idea drop out of the add field.
  const already = new Set(
    recipients.map((r) =>
      partyKey({ type: r.recipientType, id: r.recipientId }),
    ),
  );

  const ordered = sortGiftsGivenLast(recipients, (row) => row.recipientLabel);

  function addFor(candidate: RecipientCandidate) {
    core.gifts.recipients
      .create({
        giftIdeaId: ideaId,
        party: { type: candidate.type, id: candidate.id },
      })
      .then(
        () => onChanged(),
        (e: unknown) => Alert.alert("Couldn't save", String(e)),
      );
  }

  function setGiven(row: GiftForIdea, given: boolean) {
    core.gifts.recipients.update(row.id, { given }).then(
      () => onChanged(),
      (e: unknown) => Alert.alert("Couldn't save", String(e)),
    );
  }

  function confirmRemove(row: GiftForIdea) {
    Alert.alert(
      "Remove recipient",
      `Stop listing this for ${row.recipientLabel}?`,
      [
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
      ],
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>For…</Text>
      </View>

      <Typeahead
        multi
        label="Add a person or pet this would suit"
        value={null}
        options={candidates}
        exclude={already}
        onChange={(candidate) => candidate !== null && addFor(candidate)}
        getKey={partyKey}
        getLabel={(c) => c.label}
      />

      {ordered.length === 0 ? (
        <Text style={styles.muted}>Not for anyone in particular yet.</Text>
      ) : (
        ordered.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowMeta}>
              <Text style={styles.rowText}>{row.recipientLabel}</Text>
              <Switch
                value={isGiven(row)}
                onValueChange={(given) => setGiven(row, given)}
              />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>
                {isGiven(row) ? "✓ Given" : "Not given yet"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.recipientLabel}`}
                onPress={() => confirmRemove(row)}
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
