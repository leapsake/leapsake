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

/**
 * A gift being authored on this form: the draft the write will use, plus a key to
 * address the row by. See {@link StagedContact}, which is the same idea for the
 * same reasons.
 */
export interface StagedGift {
  key: string;
  draft: GiftDraft;
}

/** Whether every row would write cleanly or be skipped — the Save gate. */
export const giftRowsValid = (entries: readonly StagedGift[]): boolean =>
  entries.every((row) => giftDraftValid(row.draft));

/**
 * Gifts on the **create** screen — the staged counterpart to
 * {@link GiftsSection}, held in memory until the form is saved and then written
 * through `core.gifts.capture`. See {@link StagedMilestonesSection} for why
 * staging works this way.
 *
 * Everything here is a gift being *added*, because a record being created has no
 * gifts yet. It briefly served a saved record too, and so carried a set of ticks
 * and removals staged against rows that already existed; a saved recipient's
 * gifts are ticked and dropped where they are listed now, which is a write and
 * not a draft, so that half is gone.
 *
 * This section used to take an `occasions` pool as a prop, because a gift's
 * occasion could name a milestone staged on this same form — one that had no id
 * yet. That forward reference is why the screen had to build a pool of staged
 * keys and the write had to map them back (`resolveStagedOccasion`), and why
 * `applyEntityForm` had to write milestones first and gifts last. A gift now
 * names nothing but the entity the form is about, so all of it is gone.
 *
 * The idea pool *is* read here, being ordinary catalog data: `gifts/new.tsx` gets
 * it from a route loader this section doesn't have, so this fetches it the way
 * {@link StagedHolidaysSection} fetches the holiday catalog.
 */
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
          {/* The row's identity line, as every staged section has: what it is so
              far, next to the way out of it. Blank until it is named, because
              "New gift" is the one thing the fields below already say. */}
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

          {/* The one thing a gift cannot do without, said where it is missing
              rather than only as a disabled Save at the top of the screen. */}
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
