import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type { GiftIdea, GiftOccasion } from "@leapsake/schema";
import { groupGiftsByIdea } from "@leapsake/view-models";
import {
  type DateFields,
  type GiftOccasionChoice,
  type PartyOption,
  dateFieldsOf,
  giftIdeaOf,
  usePartyContext,
} from "@leapsake/ui/headless";
import { useGiftPartyLoaders } from "../lib/gifts-ports";
import {
  type GiftDraft,
  GiftIdentityFields,
  GiftRecipientArm,
  emptyGiftDraft,
  giftDraftValid,
} from "./GiftFields";
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

/**
 * A gift being authored on this form: the draft the write will use, plus a key to
 * address the row by. See {@link StagedContact}, which is the same idea for the
 * same reasons — a gift has no saved counterpart here (a *revision* to a saved
 * row is staged separately, in `adornments`), so there is no `savedId`.
 */
export interface StagedGift {
  key: string;
  draft: GiftDraft;
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

/** Whether every added row would write cleanly or be skipped — the Save gate. */
export const giftRowsValid = (value: StagedGiftEdits): boolean =>
  value.added.every((row) => giftDraftValid(row.draft));

/** The saved rows the edit screen reads back; the create screen has none. */
export interface SavedGifts {
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
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
 * **Every row is open** — the saved ones and the added ones alike. A saved row
 * offers what the detail page's editor did and no more: its occasion and date, or
 * removal. An added row is a whole {@link GiftDraft}, typed straight into the
 * list. That last part is new: adding a gift used to open a *sub-form* with its
 * own `Cancel  Add` pair, which committed a frozen payload the list could then
 * only show as a summary line and a Remove — the reasoning being that capturing a
 * gift was several arms of state resolving into one payload rather than a row you
 * type into. Once those arms became one controlled draft that stopped being true,
 * and this section now matches every other staged one
 * ({@link StagedContactsSection}): "Add gift" appends a row, Remove takes it out,
 * and the form's one Save writes the difference.
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
   * fields' re-gift guard ("she was already given this"). Absent on the create
   * screen, where the recipient has no id to ask about yet.
   */
  recipient?: PartyOption;
  saved?: SavedGifts;
  value: StagedGiftEdits;
  onChange: (value: StagedGiftEdits) => void;
}) {
  const core = useCore();
  const partyLoaders = useGiftPartyLoaders();
  const [ideaPool, setIdeaPool] = useState<GiftIdea[]>([]);

  // The re-gift guard's source: what the entity has already been given. Only the
  // edit screen has a `recipient` to ask about — on the create screen there is no
  // one yet, and an entity that doesn't exist can't have been given anything.
  const pools = usePartyContext(recipient ? [recipient] : [], partyLoaders);

  /** The existing idea a row's title names, if any — what the guard keys off. A
   *  brand-new title can't have been given before. */
  const typedIdeaId = (draft: GiftDraft) => {
    const idea = giftIdeaOf(draft, ideaPool);
    return "id" in idea ? idea.id : undefined;
  };

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

  /** Revise a saved row's pair — the change this section stages for it. */
  const adorn = (key: string, pair: GiftAdornments) =>
    onChange({ ...value, adornments: { ...value.adornments, [key]: pair } });

  /** One saved suggestion or giving: what it is, its way out, and its two fields. */
  function savedRow(key: string, lead: string, stored: GiftAdornments) {
    if (removed.has(key)) return null;
    const pair = adornmentsOf(key, stored);
    return (
      <View key={key} style={styles.inlineForm}>
        <View style={styles.rowMeta}>
          <Text style={styles.muted}>{lead}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${lead}`}
            onPress={() => drop(key)}
          >
            <Text style={[styles.link, styles.danger]}>Remove</Text>
          </Pressable>
        </View>
        <GiftOccasionFields
          kind={key.startsWith("suggestion:") ? "suggestion" : "giving"}
          occasions={occasions}
          occasion={pair.occasion}
          onOccasionChange={(occasion) => adorn(key, { ...pair, occasion })}
          date={pair.date}
          onDateChange={(date) => adorn(key, { ...pair, date })}
        />
      </View>
    );
  }

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
          <GiftRecipientArm
            kind={row.draft.kind}
            label={recipient?.label}
            given={
              recipient === undefined
                ? []
                : pools.alreadyGiven(recipient, typedIdeaId(row.draft))
            }
            occasions={occasions}
            givings={row.draft.givings}
            onGivingsChange={(givings) =>
              patchAdded(row.key, { ...row.draft, givings })
            }
            suggestion={row.draft.suggestion}
            onSuggestionChange={(suggestion) =>
              patchAdded(row.key, { ...row.draft, suggestion })
            }
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
