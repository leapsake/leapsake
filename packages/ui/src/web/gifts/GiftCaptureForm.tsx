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
 * Captures a gift in one submit: its name or link, who it is for, and who has
 * it. `fixedRecipient` and `recipientCandidates` are mutually exclusive.
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
  /** Opens already ticked, for the completed gift reminder's hand-off. */
  startGiven?: boolean;
  /** Called after a successful save. */
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

/** A gift, and who it is for with a tick each. */
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
