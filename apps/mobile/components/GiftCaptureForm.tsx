import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import type { GiftIdea } from "@leapsake/schema";
import {
  type PartyOption,
  type RecipientEntry,
  captureRecipientOf,
  giftIdeaOf,
  newRecipientEntry,
  partyKey,
  patchRecipient,
  removeRecipient,
} from "@leapsake/ui/headless";
import {
  type GiftDraft,
  GiftGivenToggle,
  GiftIdentityFields,
  emptyGiftDraft,
} from "./GiftFields";
import { HeaderSave } from "./HeaderSave";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

/**
 * The one consolidated "capture a gift" **screen** — a {@link GiftDraft} plus
 * whoever it is for, and the single `core.gifts.capture` that writes them. The
 * fields themselves are {@link GiftIdentityFields} and {@link GiftGivenToggle},
 * which the entity forms' {@link StagedGiftsSection} renders directly; this is
 * the wrapper that owns state and has a Save.
 *
 * Name a gift (autocompleting existing ideas) or paste a link; that alone
 * captures an **idea**. On the Gifts screen you then add **recipients**; on a
 * Person/Pet screen the recipient is fixed. Tick anyone who already has it. One
 * submit, one transaction.
 *
 * `fixedRecipient` (one known recipient) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the recipient picker, the latter shows
 * a multi-add typeahead over people/pets, each picked party carrying **its own**
 * tick while the name above is shared.
 *
 * This form used to open by asking which of two things it was — "Idea" or
 * "Already gave it" — because the answer chose which table the submit wrote to,
 * and reshaped every field below it into either dated giving rows or a target
 * occasion. With one table there is nothing to ask, and the answer is the
 * checkbox on each recipient.
 */
export function GiftCaptureForm({
  title: headerTitle,
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startGiven = false,
  onSaved,
}: {
  /** The native header title, set here so it's declared in one place. */
  title: string;
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: PartyOption[];
  /** Open with the box already ticked — the completed-gift-reminder hand-off,
   *  where the answer to "record what you gave" is that you gave it. */
  startGiven?: boolean;
  /** Called after a successful save — the screen decides whether that means
   *  reloading in place or navigating away. */
  onSaved?: () => void;
}) {
  const core = useCore();

  const [draft, setDraft] = useState<GiftDraft>(() =>
    emptyGiftDraft(startGiven),
  );
  // Gifts-screen mode: recipients each carry their own tick.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenKeys = new Set(recipients.map((r) => partyKey(r.option)));
  const trimmedTitle = draft.title.trim();

  function reset() {
    setDraft(emptyGiftDraft(startGiven));
    setRecipients([]);
  }

  async function submit() {
    if (trimmedTitle === "") {
      setError("A gift needs a name.");
      return;
    }

    const captureRecipients = fixedRecipient
      ? [captureRecipientOf(fixedRecipient, draft.given)]
      : recipients.map((r) => captureRecipientOf(r.option, r.given));

    setBusy(true);
    setError(null);
    try {
      await core.gifts.capture({
        giftIdea: giftIdeaOf(draft, ideaPool),
        recipients: captureRecipients,
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
        <GiftGivenToggle
          testID="gift-given"
          label={fixedRecipient.label}
          value={draft.given}
          onChange={(given) => setDraft({ ...draft, given })}
        />
      ) : (
        <View style={styles.section}>
          <Typeahead
            multi
            label="Who's it for? (optional)"
            value={null}
            options={recipientCandidates ?? []}
            exclude={chosenKeys}
            onChange={(option) =>
              option !== null &&
              setRecipients((prev) => [...prev, newRecipientEntry(option)])
            }
            getKey={partyKey}
            getLabel={(c) => c.label}
          />
          {recipients.map((r) => {
            const key = partyKey(r.option);
            return (
              <View key={key} style={styles.row}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{r.option.label}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${r.option.label}`}
                    onPress={() =>
                      setRecipients((prev) => removeRecipient(prev, key))
                    }
                  >
                    <Text style={[styles.link, styles.danger]}>Remove</Text>
                  </Pressable>
                </View>
                <GiftGivenToggle
                  value={r.given}
                  onChange={(given) =>
                    setRecipients((prev) =>
                      patchRecipient(prev, key, { given }),
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
