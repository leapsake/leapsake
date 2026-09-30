import { Alert, Pressable, Text } from "react-native";
import type { GiftForIdea } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { partyKey } from "@leapsake/ui/headless";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { CheckboxBox } from "./Checkbox";
import { RecordSection } from "./RecordSection";
import { rowMenuItem } from "./RowMenu";
import { SummaryRow } from "./SummaryRow";
import { Typeahead } from "./Typeahead";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A person/pet the idea can be for — the add field's pool. */
export interface RecipientCandidate {
  type: GiftPartyType;
  id: string;
  label: string;
}

/** Who a gift idea is for: the other end of a person's Gifts section, each
 *  row's whole state its checkbox. */
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
    <RecordSection
      title="For…"
      isEmpty={ordered.length === 0}
      emptyText="Not for anyone in particular yet."
    >
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

      {ordered.map((row) => (
        <SummaryRow
          key={row.id}
          title={
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isGiven(row) }}
              accessibilityLabel={row.recipientLabel}
              style={styles.rowWithLead}
              onPress={() => setGiven(row, !isGiven(row))}
            >
              <CheckboxBox checked={isGiven(row)} />
              <Text style={styles.rowText}>{row.recipientLabel}</Text>
            </Pressable>
          }
          detail={isGiven(row) ? "✓ Given" : "Not given yet"}
          menu={{
            subject: row.recipientLabel,
            items: [rowMenuItem.remove(() => confirmRemove(row))],
          }}
        />
      ))}
    </RecordSection>
  );
}
