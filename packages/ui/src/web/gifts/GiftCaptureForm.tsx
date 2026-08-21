import type { GiftIdea } from "@leapsake/schema";
import { type FormEvent, useId, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import {
  type PartyOption,
  type RecipientEntry,
  captureRecipientOf,
  giftIdeaOf,
  newRecipientEntry,
  partyKey,
  patchRecipient,
  removeRecipient,
  useGiftsPorts,
} from "../../headless/index.js";

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
  const listId = useId();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  // Fixed-recipient mode: the one recipient's checkbox.
  const [fixedGiven, setFixedGiven] = useState(startGiven);
  // Gifts-screen mode: recipients each carry their own.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenIds = new Set(recipients.map((r) => partyKey(r.option)));
  const addableRecipients = (recipientCandidates ?? []).filter(
    (c) => !chosenIds.has(partyKey(c)),
  );

  const trimmedTitle = title.trim();

  function reset() {
    setTitle("");
    setUrl("");
    setFixedGiven(startGiven);
    setRecipients([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmedTitle === "") {
      setError(m.giftCapture.missingTitle);
      return;
    }

    const captureRecipients = fixedRecipient
      ? [captureRecipientOf(fixedRecipient, fixedGiven)]
      : recipients.map((r) => captureRecipientOf(r.option, r.given));

    setBusy(true);
    setError(null);
    try {
      await ports.capture({
        giftIdea: giftIdeaOf({ title, url }, ideaPool),
        recipients: captureRecipients,
      });
      reset();
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <p>
          <label htmlFor={`${listId}-title`}>{m.giftCapture.giftLabel}</label>
          <br />
          <input
            id={`${listId}-title`}
            list={listId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={m.giftCapture.titlePlaceholder}
          />
          <datalist id={listId}>
            {ideaPool.map((i) => (
              <option key={i.id} value={i.title} />
            ))}
          </datalist>{" "}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
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
                checked={fixedGiven}
                onChange={(e) => setFixedGiven(e.target.checked)}
              />{" "}
              {m.giftCapture.alreadyGiven(fixedRecipient.label)}
            </label>
          </p>
        ) : (
          <div>
            <MultiAddCombobox
              label={m.giftCapture.addRecipientLabel}
              placeholder={m.giftCapture.addRecipientPlaceholder}
              options={addableRecipients}
              getKey={partyKey}
              getLabel={(c) => c.label}
              onPick={(c) =>
                setRecipients((prev) => [...prev, newRecipientEntry(c)])
              }
              announceAdded={m.combobox.added}
              announceCount={m.combobox.suggestionCount}
            />
            <ul>
              {recipients.map((r) => {
                const key = partyKey(r.option);
                return (
                  <li key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={r.given}
                        onChange={(e) =>
                          setRecipients((prev) =>
                            patchRecipient(prev, key, {
                              given: e.target.checked,
                            }),
                          )
                        }
                      />{" "}
                      {m.giftCapture.alreadyGiven(r.option.label)}
                    </label>{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((prev) => removeRecipient(prev, key))
                      }
                    >
                      {m.giftCapture.removeRecipient}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error !== null && <p>{m.common.saveFailed(error)}</p>}

        <p>
          <button type="submit">{m.giftCapture.submit}</button>
        </p>
      </fieldset>
    </form>
  );
}
