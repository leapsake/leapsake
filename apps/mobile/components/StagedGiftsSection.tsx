import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GiftIdea } from "@leapsake/schema";
import {
  type GiftDraft,
  GiftGivenCheckbox,
  GiftIdentityFields,
  emptyGiftDraft,
  giftDraftValid,
} from "./GiftFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A gift being created on the form, keyed for React. */
export interface StagedGift {
  key: string;
  draft: GiftDraft;
}

/** Whether every row would write cleanly or be skipped — the Save gate. */
export const giftRowsValid = (entries: readonly StagedGift[]): boolean =>
  entries.every((row) => giftDraftValid(row.draft));

/** Gifts staged on the create form; it reads the idea pool itself, as
 *  {@link StagedHolidaysSection} reads the holiday catalog. */
export function StagedGiftsSection({
  entries,
  onChange,
}: {
  entries: StagedGift[];
  onChange: (entries: StagedGift[]) => void;
}) {
  const core = useCore();
  const [ideaPool, setIdeaPool] = useState<GiftIdea[]>([]);

  useEffect(() => {
    let active = true;
    void core.gifts.ideas.list().then((ideas) => {
      if (active) setIdeaPool(ideas);
    });
    return () => {
      active = false;
    };
  }, [core]);

  /** Replace one row's draft, addressed by its key. */
  const patch = (key: string, draft: GiftDraft) =>
    onChange(entries.map((row) => (row.key === key ? { ...row, draft } : row)));

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
      </View>

      {entries.map((row) => (
        <View key={row.key} style={[styles.row, styles.inlineForm]}>
          {/* Says which gift this Remove is for; blank until it is named. */}
          <View style={styles.sectionHeader}>
            <Text style={styles.fieldLabel}>
              {row.draft.title.trim() === ""
                ? "New gift"
                : row.draft.title.trim()}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${
                row.draft.title.trim() === "" ? "new gift" : row.draft.title
              }`}
              onPress={() => onChange(entries.filter((r) => r.key !== row.key))}
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>

          <GiftIdentityFields
            draft={row.draft}
            onChange={(draft) => patch(row.key, draft)}
            ideaPool={ideaPool}
          />
          <GiftGivenCheckbox
            value={row.draft.given}
            onChange={(given) => patch(row.key, { ...row.draft, given })}
          />

          {/* A name, said where it is missing, not only at Save. */}
          {!giftDraftValid(row.draft) && (
            <Text style={styles.danger}>This gift needs a name.</Text>
          )}
        </View>
      ))}

      {entries.length === 0 && <Text style={styles.muted}>No gifts yet.</Text>}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange([
            ...entries,
            { key: crypto.randomUUID(), draft: emptyGiftDraft() },
          ])
        }
      >
        <Text style={styles.link}>Add gift</Text>
      </Pressable>
    </View>
  );
}
