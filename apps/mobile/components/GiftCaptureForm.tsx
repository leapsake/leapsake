import { useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import type { GiftIdea } from "@leapsake/schema";
import {
  type GiftCaptureDraft,
  type PartyOption,
  partyKey,
  useGiftCaptureForm,
} from "@leapsake/ui/headless";
import {
  GiftGivenCheckbox,
  GiftIdentityFields,
  giftDraftEmpty,
} from "./GiftFields";
import { useHeaderSave } from "./HeaderSave";
import { DraftRow } from "./DraftRow";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

const TEXT = {
  recipientsLabel: "Who’s it for? (optional)",
  titleRequired: "A gift needs a name.",
  saveFailed: (error: string) => `Couldn’t save: ${error}`,
};

/**
 * The "capture a gift" screen: {@link useGiftCaptureForm}'s draft rendered by
 * {@link GiftCaptureFields}, and the one `core.gifts.capture` that writes it.
 */
export function GiftCaptureForm({
  title,
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
  /** Open ticked, for the hand-off from a completed gift reminder. */
  startGiven?: boolean;
  /** After a save; the screen decides whether to reload or leave. */
  onSaved?: () => void;
}) {
  const core = useCore();
  const form = useGiftCaptureForm({ ideaPool, fixedRecipient, startGiven });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headerRight = useHeaderSave({
    problem: form.errors.title === "required" ? TEXT.titleRequired : undefined,
    saving: busy,
    onPress: () => void submit(),
  });

  async function submit() {
    const shaped = form.submit();
    if (shaped === null) return;
    setBusy(true);
    setError(null);
    try {
      await core.gifts.capture(shaped.input);
      form.reset();
      onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Stack.Screen options={{ title, headerRight }} />
      <GiftCaptureFields
        fields={form.fields}
        onIdentityChange={(d) =>
          form.update((f) => ({
            ...f,
            title: d.title,
            url: d.url,
            imageUrl: d.imageUrl,
            given: d.given,
          }))
        }
        ideaPool={ideaPool}
        fixedRecipient={fixedRecipient}
        candidates={recipientCandidates ?? []}
        chosen={form.chosen}
        onAddRecipient={form.addRecipient}
        onRemoveRecipient={form.removeRecipient}
        onRecipientGiven={form.setRecipientGiven}
      />
      {error !== null && (
        <Text style={styles.danger}>{TEXT.saveFailed(error)}</Text>
      )}
    </View>
  );
}

/** A gift, and who it is for with a tick each (or the one fixed
 *  recipient's), asked once the gift has a name or a link. */
export function GiftCaptureFields({
  fields,
  onIdentityChange,
  ideaPool,
  fixedRecipient,
  candidates,
  chosen,
  onAddRecipient,
  onRemoveRecipient,
  onRecipientGiven,
}: {
  fields: GiftCaptureDraft;
  onIdentityChange: (
    draft: Pick<GiftCaptureDraft, "title" | "url" | "imageUrl" | "given">,
  ) => void;
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  candidates: PartyOption[];
  chosen: ReadonlySet<string>;
  onAddRecipient: (option: PartyOption) => void;
  onRemoveRecipient: (key: string) => void;
  onRecipientGiven: (key: string, given: boolean) => void;
}) {
  return (
    <>
      <GiftIdentityFields
        draft={fields}
        onChange={onIdentityChange}
        ideaPool={ideaPool}
      />

      {fixedRecipient ? (
        <GiftGivenCheckbox
          testID="gift-given"
          label={fixedRecipient.label}
          value={fields.given}
          onChange={(given) => onIdentityChange({ ...fields, given })}
        />
      ) : giftDraftEmpty(fields) ? null : (
        <View style={styles.section}>
          <Typeahead
            multi
            label={TEXT.recipientsLabel}
            value={null}
            options={candidates}
            exclude={chosen}
            onChange={(option) => option !== null && onAddRecipient(option)}
            getKey={partyKey}
            getLabel={(c) => c.label}
          />
          {fields.recipients.map((r) => {
            const key = partyKey(r.option);
            return (
              <DraftRow
                key={key}
                label={r.option.label}
                subject={r.option.label}
                onRemove={() => onRemoveRecipient(key)}
              >
                <GiftGivenCheckbox
                  value={r.given}
                  onChange={(given) => onRecipientGiven(key, given)}
                />
              </DraftRow>
            );
          })}
        </View>
      )}
    </>
  );
}
