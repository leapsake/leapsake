import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GiftForRecipient } from "@leapsake/core";
import type { GiftIdea } from "@leapsake/schema";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import {
  type GiftDraft,
  GiftGivenToggle,
  GiftIdentityFields,
  emptyGiftDraft,
  giftDraftValid,
} from "./GiftFields";
import { GiftLink } from "./GiftsSection";
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

/** Everything this section holds until the form is saved. */
export interface StagedGiftEdits {
  /** Gifts to capture — the only kind of change the create screen can make. */
  added: StagedGift[];
  /** Ticks flipped on saved rows, by row id. Absent means "as stored". */
  given: Record<string, boolean>;
  /** Saved rows to drop, by row id. */
  removed: string[];
}

export const emptyGiftEdits = (): StagedGiftEdits => ({
  added: [],
  given: {},
  removed: [],
});

/** Whether every added row would write cleanly or be skipped — the Save gate. */
export const giftRowsValid = (value: StagedGiftEdits): boolean =>
  value.added.every((row) => giftDraftValid(row.draft));

/**
 * Gifts on the **create** and **edit** screens — the staged counterpart to
 * {@link GiftsSection}, held in memory until the form is saved and then written
 * through `core.gifts.capture` (added) and `core.gifts.recipients` (ticked or
 * dropped). See {@link StagedMilestonesSection} for why staging works this way.
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
 *
 * **Every row is open** — the saved ones and the added ones alike. A saved row
 * offers its tick and a Remove; an added row is a whole {@link GiftDraft}, typed
 * straight into the list.
 */
export function StagedGiftsSection({
  recipientLabel,
  saved,
  value,
  onChange,
}: {
  /** Whose gifts these are, where that is already somebody — the toggle says so
   *  by name. Absent on the create screen, where they have no name yet. */
  recipientLabel?: string;
  saved?: readonly GiftForRecipient[];
  value: StagedGiftEdits;
  onChange: (value: StagedGiftEdits) => void;
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

  const removed = new Set(value.removed);
  const ordered = sortGiftsGivenLast(saved ?? [], (row) => row.ideaTitle);

  /** What a saved row's tick currently stands for: the staged flip, else stored. */
  const givenOf = (row: GiftForRecipient): boolean =>
    value.given[row.id] ?? isGiven(row);

  const drop = (id: string) =>
    onChange({ ...value, removed: [...value.removed, id] });

  const tick = (id: string, given: boolean) =>
    onChange({ ...value, given: { ...value.given, [id]: given } });

  /** Replace one added row's draft, addressed by its key. */
  const patchAdded = (key: string, draft: GiftDraft) =>
    onChange({
      ...value,
      added: value.added.map((row) =>
        row.key === key ? { ...row, draft } : row,
      ),
    });

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
      </View>

      {ordered.map((row) => {
        if (removed.has(row.id)) return null;
        return (
          <View key={row.id} style={styles.row}>
            <View style={styles.sectionHeader}>
              <Text style={styles.rowText}>{row.ideaTitle}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.ideaTitle}`}
                onPress={() => drop(row.id)}
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
            {row.ideaUrl !== null && <GiftLink url={row.ideaUrl} />}
            <GiftGivenToggle
              label={recipientLabel}
              value={givenOf(row)}
              onChange={(given) => tick(row.id, given)}
            />
          </View>
        );
      })}

      {value.added.map((row) => (
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
              onPress={() =>
                onChange({
                  ...value,
                  added: value.added.filter((r) => r.key !== row.key),
                })
              }
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>

          <GiftIdentityFields
            draft={row.draft}
            onChange={(draft) => patchAdded(row.key, draft)}
            ideaPool={ideaPool}
          />
          <GiftGivenToggle
            label={recipientLabel}
            value={row.draft.given}
            onChange={(given) => patchAdded(row.key, { ...row.draft, given })}
          />

          {/* The one thing a gift cannot do without, said where it is missing
              rather than only as a disabled Save at the top of the screen. */}
          {!giftDraftValid(row.draft) && (
            <Text style={styles.danger}>This gift needs a name.</Text>
          )}
        </View>
      ))}

      {ordered.length === 0 && value.added.length === 0 && (
        <Text style={styles.muted}>No gifts yet.</Text>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange({
            ...value,
            added: [
              ...value.added,
              { key: crypto.randomUUID(), draft: emptyGiftDraft() },
            ],
          })
        }
      >
        <Text style={styles.link}>Add gift</Text>
      </Pressable>
    </View>
  );
}
