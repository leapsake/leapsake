import type { GiftIdea } from "@leapsake/schema";
import { type FormEvent, useId, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import {
  type GiftCaptureDraft,
  type PartyOption,
  partyKey,
  useGiftCaptureForm,
  useGiftsPorts,
} from "../../headless/index.js";
import styles from "../patterns/not-ready.module.css";
import { showFormProblem } from "../patterns/form-problem.js";

/**
 * The one consolidated "capture a gift" form: name the gift (autocompleting
 * existing ideas) or paste a link, say who it is for, and tick anyone who already
 * has it. One submit, one transaction.
 *
 * `fixedRecipient` (Person/Pet screen) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the picker and offers the one
 * checkbox, the latter shows a multi-add over people and pets with a checkbox
 * each.
 *
 * The form used to open by asking **which of two things** this was — "Idea" or
 * "Already gave it" — because the answer chose which table the submit wrote to.
 * With one table there is nothing to ask: the question was never really about the
 * gift, it was about the schema. Its dated giving rows, its target-date arm and
 * its occasion pickers went with it.
 */
export function GiftCaptureForm({
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startGiven = false,
  onSaved,
}: {
  ideaPool: readonly GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: readonly PartyOption[];
  /** Open with the box already ticked — the completed-gift-reminder hand-off,
   *  where the answer to "record what you gave" is that you gave it. */
  startGiven?: boolean;
  /**
   * Called after a successful save. A standalone create screen navigates away;
   * an inline section re-reads its data in place — the form itself only knows
   * that it finished.
   */
  onSaved: () => void;
}) {
  const ports = useGiftsPorts();
  const m = useMessages();
  const form = useGiftCaptureForm({ ideaPool, fixedRecipient, startGiven });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const shaped = form.submit();
    if (shaped === null) return showFormProblem(m.giftCapture.missingTitle);
    setBusy(true);
    setError(null);
    try {
      await ports.capture(shaped.input);
      form.reset();
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <GiftCaptureFields
        fields={form.fields}
        set={form.set}
        ideaPool={ideaPool}
        fixedRecipient={fixedRecipient}
        addable={(recipientCandidates ?? []).filter(
          (c) => !form.chosen.has(partyKey(c)),
        )}
        onAddRecipient={form.addRecipient}
        onRemoveRecipient={form.removeRecipient}
        onRecipientGiven={form.setRecipientGiven}
      />
      {error !== null && <p>{m.common.saveFailed(error)}</p>}
      <p>
        <button
          type="submit"
          className={form.canSubmit ? undefined : styles.notReady}
          aria-disabled={busy}
        >
          {m.giftCapture.submit}
        </button>
      </p>
    </form>
  );
}

/** A gift, and who it is for with a tick each (or the one fixed recipient's). */
export function GiftCaptureFields({
  fields,
  set,
  ideaPool,
  fixedRecipient,
  addable,
  onAddRecipient,
  onRemoveRecipient,
  onRecipientGiven,
}: {
  fields: GiftCaptureDraft;
  set: <K extends keyof GiftCaptureDraft>(
    key: K,
    value: GiftCaptureDraft[K],
  ) => void;
  ideaPool: readonly GiftIdea[];
  fixedRecipient?: PartyOption;
  /** The candidates not yet picked. */
  addable: readonly PartyOption[];
  onAddRecipient: (option: PartyOption) => void;
  onRemoveRecipient: (key: string) => void;
  onRecipientGiven: (key: string, given: boolean) => void;
}) {
  const m = useMessages();
  const listId = useId();

  return (
    <fieldset>
      <p>
        <label htmlFor={`${listId}-title`}>{m.giftCapture.giftLabel}</label>
        <br />
        <input
          id={`${listId}-title`}
          list={listId}
          value={fields.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={m.giftCapture.titlePlaceholder}
        />
        <datalist id={listId}>
          {ideaPool.map((i) => (
            <option key={i.id} value={i.title} />
          ))}
        </datalist>{" "}
        <input
          value={fields.url}
          onChange={(e) => set("url", e.target.value)}
          type="url"
          placeholder={m.giftCapture.urlPlaceholder}
          aria-label={m.giftCapture.urlLabel}
        />
      </p>

      {fixedRecipient ? (
        <p>
          <label>
            <input
              type="checkbox"
              checked={fields.given}
              onChange={(e) => set("given", e.target.checked)}
            />{" "}
            {m.giftCapture.alreadyGiven(fixedRecipient.label)}
          </label>
        </p>
      ) : (
        <div>
          <MultiAddCombobox
            label={m.giftCapture.addRecipientLabel}
            placeholder={m.giftCapture.addRecipientPlaceholder}
            options={addable}
            getKey={partyKey}
            getLabel={(c) => c.label}
            onPick={onAddRecipient}
            announceAdded={m.combobox.added}
            announceCount={m.combobox.suggestionCount}
          />
          <ul>
            {fields.recipients.map((r) => {
              const key = partyKey(r.option);
              return (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={r.given}
                      onChange={(e) => onRecipientGiven(key, e.target.checked)}
                    />{" "}
                    {m.giftCapture.alreadyGiven(r.option.label)}
                  </label>{" "}
                  <button type="button" onClick={() => onRemoveRecipient(key)}>
                    {m.giftCapture.removeRecipient}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
