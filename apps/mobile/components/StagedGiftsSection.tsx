import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type { GiftIdea, GiftOccasion } from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import { groupGiftsByIdea } from "@leapsake/view-models";
import {
  type DateFields,
  type GiftOccasionChoice,
  type PartyOption,
  dateFieldsOf,
  givingsOf,
  occasionKey,
  parseDateFields,
} from "@leapsake/ui/headless";
import { GiftCaptureForm, type StagedGift } from "./GiftCaptureForm";
import { GiftLink } from "./GiftsSection";
import { GiftOccasionFields } from "./GiftOccasionFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * What a saved suggestion or giving can be revised to. The pair is the whole of
 * it: a suggestion *is* idea × recipient and a giving is a dated fact, so
 * changing anything else means a different row, not an edit — the same rule the
 * detail page's in-place editor drew.
 */
export interface GiftAdornments {
  occasion: GiftOccasion | null;
  date: DateFields;
}

/** Everything this section holds until the form is saved. */
export interface StagedGiftEdits {
  /** Gifts to capture — the only kind of change the create screen can make. */
  added: StagedGift[];
  /** Revisions to saved rows, keyed by {@link giftRowKey}. */
  adornments: Record<string, GiftAdornments>;
  /** Saved rows to drop, by the same key. */
  removed: string[];
}

/** A saved row's address in {@link StagedGiftEdits}; the two kinds share an id space. */
export const giftRowKey = (kind: "suggestion" | "giving", id: string): string =>
  `${kind}:${id}`;

export const emptyGiftEdits = (): StagedGiftEdits => ({
  added: [],
  adornments: {},
  removed: [],
});

/** The saved rows the edit screen reads back; the create screen has none. */
export interface SavedGifts {
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
}

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

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

/** What an adornment pair reads as: its occasion's name, then its date. */
function adornmentBits(
  value: GiftAdornments,
  occasions: readonly GiftOccasionChoice[],
): string {
  const key = occasionKey(value.occasion);
  const label = occasions.find((o) => occasionKey(o) === key)?.label ?? null;
  const date = formatGiftDate(
    parseDateFields(value.date) ?? { year: null, month: null, day: null },
  );
  return joinBits([label, date === "" ? null : date]);
}

/**
 * Gifts on the **create** and **edit** screens — the staged counterpart to
 * {@link GiftsSection}, held in memory until the form is saved and then written
 * through `core.gifts.capture` (added) and `core.gifts.{suggestions,given}`
 * (revised or dropped). See {@link StagedMilestonesSection} for why staging works
 * this way.
 *
 * The recipient is the entity the form is about, so unlike every other staged
 * section this one has a forward reference to work around: a gift's **occasion**
 * points at a milestone or holiday by id, and a milestone staged on this same
 * form has no id yet. `occasions` is therefore supplied by the screen — staged
 * milestones under their placeholder keys (a saved milestone's key *is* its id),
 * staged holidays under their real catalog ids — and the screen rewrites the keys
 * as it writes. That is also why the section takes the pool rather than reading
 * `core.gifts.occasionsFor`, which needs a saved party and would not know about
 * anything staged beside it.
 *
 * The idea pool *is* read here, being ordinary catalog data: `gifts/new.tsx` gets
 * it from a route loader this section doesn't have, so this fetches it the way
 * {@link StagedHolidaysSection} fetches the holiday catalog.
 *
 * A **saved** row offers what the detail page's editor did and no more — its
 * occasion and date, or removal. A row **added here** offers only removal:
 * re-opening a capture that has not been written is a form with four arms to
 * re-seed, and deleting a row typed a minute ago costs one tap.
 */
export function StagedGiftsSection({
  occasions,
  recipient,
  saved,
  value,
  onChange,
}: {
  /** Everything a gift may name as its occasion — see above. */
  occasions: readonly GiftOccasionChoice[];
  /**
   * Who the gifts are for, where that is already somebody: it buys the capture
   * form's re-gift guard ("she was already given this"). Absent on the create
   * screen, where the recipient has no id to ask about yet.
   */
  recipient?: PartyOption;
  saved?: SavedGifts;
  value: StagedGiftEdits;
  onChange: (value: StagedGiftEdits) => void;
}) {
  const core = useCore();
  const [ideaPool, setIdeaPool] = useState<GiftIdea[] | null>(null);
  const [adding, setAdding] = useState(false);
  // The saved row being revised, if any: its key plus the pair being typed.
  const [editing, setEditing] = useState<
    (GiftAdornments & { key: string }) | null
  >(null);

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
  const ordered = groupGiftsByIdea<
    GiftSuggestionForRecipient,
    GiftForRecipient
  >(saved?.suggestions ?? [], saved?.gifts ?? []);

  /** The pair a saved row currently stands for: its revision, else what's stored. */
  const adornmentsOf = (key: string, stored: GiftAdornments): GiftAdornments =>
    value.adornments[key] ?? stored;

  const drop = (key: string) =>
    onChange({ ...value, removed: [...value.removed, key] });

  function commitEditing() {
    if (editing === null) return;
    const { key, ...pair } = editing;
    onChange({
      ...value,
      adornments: { ...value.adornments, [key]: pair },
    });
    setEditing(null);
  }

  /** One saved suggestion or giving: its summary line, its actions, its editor. */
  function savedRow(key: string, lead: string, stored: GiftAdornments) {
    if (removed.has(key)) return null;
    const open = editing?.key === key;
    const bits = adornmentBits(adornmentsOf(key, stored), occasions);
    return (
      <View key={key}>
        <View style={styles.rowMeta}>
          <Text style={styles.muted}>
            {lead}
            {bits === "" ? "" : ` — ${bits}`}
          </Text>
          <View style={styles.rowActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                open
                  ? setEditing(null)
                  : setEditing({ key, ...adornmentsOf(key, stored) })
              }
            >
              <Text style={styles.link}>{open ? "Close" : "Edit"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => drop(key)}>
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
        </View>
        {open && editing !== null && (
          <View style={styles.section}>
            <GiftOccasionFields
              label={key.startsWith("suggestion:") ? "For…" : "Given on…"}
              occasions={occasions}
              occasion={editing.occasion}
              onOccasionChange={(occasion) =>
                setEditing({ ...editing, occasion })
              }
              date={editing.date}
              onDateChange={(date) => setEditing({ ...editing, date })}
            />
            <View
              style={[styles.headerActions, { justifyContent: "flex-end" }]}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(null)}
              >
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={commitEditing}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Done</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  }

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

      {ordered.map((group) => {
        // A group whose every row has been dropped is gone from the list; the
        // idea itself outlives it, in the Gifts catalog.
        const keys = [
          ...group.suggestions.map((s) => giftRowKey("suggestion", s.id)),
          ...group.gifts.map((g) => giftRowKey("giving", g.id)),
        ];
        if (keys.every((key) => removed.has(key))) return null;
        const rows = [
          ...group.suggestions.map((s) =>
            savedRow(giftRowKey("suggestion", s.id), "Suggested", {
              occasion:
                s.occasionType !== null && s.occasionId !== null
                  ? { type: s.occasionType, id: s.occasionId }
                  : null,
              date: dateFieldsOf({
                year: s.targetYear,
                month: s.targetMonth,
                day: s.targetDay,
              }),
            }),
          ),
          ...group.gifts.map((g) =>
            savedRow(
              giftRowKey("giving", g.id),
              `✓ Given${g.giverLabel !== null ? ` from ${g.giverLabel}` : ""}`,
              {
                occasion:
                  g.occasionType !== null && g.occasionId !== null
                    ? { type: g.occasionType, id: g.occasionId }
                    : null,
                date: dateFieldsOf(g),
              },
            ),
          ),
        ];
        return (
          <View key={group.ideaId} style={styles.row}>
            <Text style={styles.rowText}>{group.title}</Text>
            {group.url !== null && <GiftLink url={group.url} />}
            {rows}
          </View>
        );
      })}

      {value.added.map((entry, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.rowText}>{entry.title}</Text>
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{stagedSummary(entry)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.title}`}
              onPress={() =>
                onChange({
                  ...value,
                  added: value.added.filter((_, i) => i !== index),
                })
              }
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
            fixedRecipient={recipient}
            stagedOccasions={occasions}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onStage={(entry) => {
              onChange({ ...value, added: [...value.added, entry] });
              setAdding(false);
            }}
          />
        )
      ) : ordered.length === 0 && value.added.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : null}
    </View>
  );
}
