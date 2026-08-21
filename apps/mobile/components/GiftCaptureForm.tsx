import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import type { CaptureRecipient, GiftIdea } from "@leapsake/schema";
import {
  type IdeaOccasionRow,
  type PartyOption,
  type RecipientEntry,
  captureRecipientOfDraft,
  giftIdeaOf,
  ideaOccasionsOf,
  newGivingRow,
  newSuggestionFields,
  partyKey,
  patchRecipient,
  removeRecipient,
  usePartyContext,
} from "@leapsake/ui/headless";
import {
  type GiftDraft,
  GiftIdentityFields,
  GiftRecipientArm,
  emptyGiftDraft,
} from "./GiftFields";
import { GiftIdeaOccasionsField } from "./GiftIdeaOccasionsField";
import { HeaderSave } from "./HeaderSave";
import { useGiftPartyLoaders } from "../lib/gifts-ports";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

/**
 * The one consolidated "capture a gift" **screen** — a {@link GiftDraft} plus
 * whoever it is for, and the single `core.gifts.capture` that writes them. The
 * fields themselves are {@link GiftIdentityFields} and {@link GiftRecipientArm},
 * which the entity forms' {@link StagedGiftsSection} renders directly; this is
 * the wrapper that owns state and has a Save.
 *
 * Name a gift (autocompleting existing ideas) or paste a link; that alone
 * captures an **idea**. On the Gifts screen you then add **recipients**; on a
 * Person/Pet screen the recipient is fixed. One submit, one transaction.
 *
 * `fixedRecipient` (one known recipient) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the recipient picker, the latter shows
 * a multi-add typeahead over people/pets, each picked party carrying **its own**
 * arm (a date under Alice is a gift to Alice) while the name and kind above are
 * shared.
 *
 * This form used to have a third mode — `inline`, with `onStage` handing the
 * payload back and a `Cancel  Add` row in the body — for the entity create and
 * edit screens. It was the last staged form to work that way, on the grounds that
 * capturing a gift was several arms of state resolving into one payload rather
 * than a row you type into. Once the arms became a single controlled draft that
 * stopped being true, and {@link StagedGiftsSection} now appends open rows like
 * every other staged section ({@link ContactMethodFields}).
 *
 * With **no recipient at all** the idea itself can name occasions
 * ({@link GiftIdeaOccasionsField}) — "this would make a good Christmas gift for
 * someone" is a whole capture, and it is the only arm here that writes nothing
 * about a person. It belongs to the Idea arm alone: an idea suits an occasion,
 * whereas a gift you have already handed over was given to somebody.
 *
 * Like the entity forms it declares its own native header — `title` plus a
 * right-aligned {@link HeaderSave} — rather than carrying a submit button at the
 * foot of a form this long.
 */
export function GiftCaptureForm({
  title: headerTitle,
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startWithGiving = false,
  onSaved,
}: {
  /** The native header title, set here so it's declared in one place. */
  title: string;
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: PartyOption[];
  /** Open on the "Already gave it" segment, so the form reads as "log a giving"
   *  rather than "shortlist an idea" (the completed-gift-reminder hand-off). */
  startWithGiving?: boolean;
  /** Called after a successful save — the screen decides whether that means
   *  reloading in place or navigating away. */
  onSaved?: () => void;
}) {
  const core = useCore();
  const partyLoaders = useGiftPartyLoaders();

  const initial = () =>
    emptyGiftDraft(startWithGiving ? "giving" : "suggestion");
  const [draft, setDraft] = useState<GiftDraft>(initial);
  // Gifts-screen mode: recipients each carry their own arm.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  // The idea's own occasions — "a good Christmas gift for someone". Offered only
  // where there is no recipient to hang them on instead (see the render below).
  const [ideaOccasions, setIdeaOccasions] = useState<IdeaOccasionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reset` and keyed onto the fields, so they remount with it. A
  // sub-form's own disclosure state — whether `WhenField` is showing its
  // year/month/day — is not something `reset` can reach by clearing values, and a
  // form that has just saved should not open on the last one's opened triple.
  const [generation, setGeneration] = useState(0);

  const chosenKeys = new Set(recipients.map((r) => partyKey(r.option)));

  // One context per party in play — the fixed recipient, or everyone picked.
  const pools = usePartyContext(
    fixedRecipient ? [fixedRecipient] : recipients.map((r) => r.option),
    partyLoaders,
  );

  const trimmedTitle = draft.title.trim();

  // The exact-title match submitting would reuse. A brand-new title can't have
  // been given before, so the re-gift guard keys off the same match.
  const typedIdea =
    trimmedTitle === ""
      ? undefined
      : ideaPool.find(
          (i) => i.title.toLowerCase() === trimmedTitle.toLowerCase(),
        );

  function reset() {
    setDraft(initial());
    setRecipients([]);
    setIdeaOccasions([]);
    setGeneration((n) => n + 1);
  }

  /** One recipient's arms as the capture payload — see
   *  {@link captureRecipientOfDraft} for why the unchosen one is dropped. */
  const payloadFor = (
    party: PartyOption,
    entry: Pick<RecipientEntry, "givings" | "suggestion">,
  ) => captureRecipientOfDraft(party, { ...entry, kind: draft.kind });

  async function submit() {
    if (trimmedTitle === "") {
      setError("A gift needs a name.");
      return;
    }

    // Saying "I gave it" and naming nobody is the one contradiction the segmented
    // control introduced, and only this arm can reach it — the other is told who
    // the gift is for.
    if (
      draft.kind === "giving" &&
      fixedRecipient === undefined &&
      recipients.length === 0
    ) {
      setError("Who did you give it to?");
      return;
    }

    const captureRecipients: CaptureRecipient[] = fixedRecipient
      ? [payloadFor(fixedRecipient, draft)]
      : recipients.map((r) => payloadFor(r.option, r));

    setBusy(true);
    setError(null);
    try {
      await core.gifts.capture({
        giftIdea: giftIdeaOf(draft, ideaPool),
        recipients: captureRecipients,
        // Zeroed in the "gave it" arm for the same reason as `payloadFor`'s: the
        // field is hidden there, and what it holds is last-time's answer.
        occasions:
          draft.kind === "suggestion" ? ideaOccasionsOf(ideaOccasions) : [],
      });
      reset();
      onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && trimmedTitle !== "";

  return (
    <View style={styles.section}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={busy}
              onPress={() => void submit()}
            />
          ),
        }}
      />

      <GiftIdentityFields
        draft={draft}
        onChange={setDraft}
        ideaPool={ideaPool}
      />

      {fixedRecipient ? (
        <GiftRecipientArm
          key={generation}
          kind={draft.kind}
          label={fixedRecipient.label}
          given={pools.alreadyGiven(fixedRecipient, typedIdea?.id)}
          occasions={pools.occasionsFor(fixedRecipient)}
          givings={draft.givings}
          onGivingsChange={(givings) => setDraft({ ...draft, givings })}
          suggestion={draft.suggestion}
          onSuggestionChange={(suggestion) =>
            setDraft({ ...draft, suggestion })
          }
        />
      ) : (
        <View style={styles.section}>
          {/*
            Above the recipient picker on purpose: "a good Christmas gift for
            someone" is a complete thought, and this is the arm that lets the form
            be finished without naming anyone. Once a recipient *is* named, their
            own {@link GiftRecipientArm} says the more specific thing — and a gift
            already handed over went to somebody, so this stays out of both the
            fixed-recipient and the gave-it arms entirely.
          */}
          {draft.kind === "suggestion" && (
            <GiftIdeaOccasionsField
              rows={ideaOccasions}
              onChange={setIdeaOccasions}
            />
          )}
          <Typeahead
            multi
            label={
              draft.kind === "giving"
                ? "Who did you give it to?"
                : "Who's it for? (optional)"
            }
            value={null}
            options={recipientCandidates ?? []}
            exclude={chosenKeys}
            onChange={(option) =>
              option !== null &&
              setRecipients((prev) => [
                ...prev,
                {
                  option,
                  givings: draft.kind === "giving" ? [newGivingRow()] : [],
                  suggestion: newSuggestionFields(),
                },
              ])
            }
            getKey={partyKey}
            getLabel={(c) => c.label}
          />
          {recipients.map((r) => {
            const key = partyKey(r.option);
            return (
              <View key={key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{r.option.label}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setRecipients((prev) => removeRecipient(prev, key))
                    }
                  >
                    <Text style={[styles.link, styles.danger]}>Remove</Text>
                  </Pressable>
                </View>
                <GiftRecipientArm
                  kind={draft.kind}
                  label={r.option.label}
                  given={pools.alreadyGiven(r.option, typedIdea?.id)}
                  occasions={pools.occasionsFor(r.option)}
                  givings={r.givings}
                  onGivingsChange={(givings) =>
                    setRecipients((prev) =>
                      patchRecipient(prev, key, { givings }),
                    )
                  }
                  suggestion={r.suggestion}
                  onSuggestionChange={(suggestion) =>
                    setRecipients((prev) =>
                      patchRecipient(prev, key, { suggestion }),
                    )
                  }
                />
              </View>
            );
          })}
        </View>
      )}

      {error !== null && (
        <Text style={styles.danger}>Couldn't save: {error}</Text>
      )}
    </View>
  );
}
