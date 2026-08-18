import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GiftIdea } from "@leapsake/schema";
import { type GiftOccasionChoice, givingsOf } from "@leapsake/ui/headless";
import { GiftCaptureForm, type StagedGift } from "./GiftCaptureForm";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * The one-line summary under a staged gift: how many givings it logs, or that it
 * is a shortlisted suggestion instead. The same distinction `gifts.capture` draws
 * — dates make it a giving, no dates make it a suggestion — read off the same
 * `givingsOf`, so a row of blank date fields counts as no giving here too.
 */
function stagedSummary(entry: StagedGift): string {
  const count = givingsOf(entry.givings).length;
  if (count === 0) return "Suggestion";
  return count === 1 ? "1 date" : `${count} dates`;
}

/**
 * Gifts on the **create** screen — the staged counterpart to {@link GiftsSection},
 * held in an array until the recipient has an id and then written through
 * `core.gifts.capture`. See {@link StagedMilestonesSection} for why staging works
 * this way.
 *
 * The recipient is the entity being created, so unlike every other staged section
 * this one has a forward reference to work around: a gift's **occasion** points at
 * a milestone or holiday by id, and a milestone staged on this same form has no id
 * yet. `occasions` is therefore supplied by the screen — staged milestones under
 * their placeholder keys, staged holidays under their real catalog ids — and the
 * screen rewrites the keys as it writes. That is also why the section takes the
 * pool rather than reading `core.gifts.occasionsFor`, which needs a saved party.
 *
 * The idea pool *is* read here, being ordinary catalog data: `gifts/new.tsx` gets
 * it from a route loader this screen doesn't have, so this fetches it the way
 * {@link StagedHolidaysSection} fetches the holiday catalog.
 *
 * Collapsed until asked for, like the other staged sections.
 */
export function StagedGiftsSection({
  occasions,
  entries,
  onChange,
}: {
  /** Everything a staged gift may name as its occasion — see above. */
  occasions: readonly GiftOccasionChoice[];
  entries: StagedGift[];
  onChange: (entries: StagedGift[]) => void;
}) {
  const core = useCore();
  const [ideaPool, setIdeaPool] = useState<GiftIdea[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    void core.gifts.ideas.list().then((ideas) => {
      if (active) setIdeaPool(ideas);
    });
    return () => {
      active = false;
    };
  }, [core]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Gifts</Text>
        {!adding && (
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)}>
            <Text style={styles.link}>Add gift</Text>
          </Pressable>
        )}
      </View>

      {entries.map((entry, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.rowText}>{entry.title}</Text>
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{stagedSummary(entry)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {adding ? (
        ideaPool === null ? (
          <Text style={styles.muted}>Loading gifts…</Text>
        ) : (
          <GiftCaptureForm
            inline
            ideaPool={ideaPool}
            stagedOccasions={occasions}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onStage={(value) => {
              onChange([...entries, value]);
              setAdding(false);
            }}
          />
        )
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : null}
    </View>
  );
}
