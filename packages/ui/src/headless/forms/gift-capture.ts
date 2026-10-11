import type { GiftIdea } from "@leapsake/schema";
import {
  giftCaptureDraftOf,
  giftCaptureInputOf,
  newRecipientEntry,
  partyKey,
  patchRecipient,
  removeRecipient,
} from "../gift-form.js";
import type { PartyOption } from "../gifts-ports.js";
import { useDraftForm } from "./use-draft-form.js";

/** The capture form's state: a gift, and who it is for with a tick each. */
export function useGiftCaptureForm({
  ideaPool,
  fixedRecipient,
  startGiven = false,
  startUrl,
  startTitle,
}: {
  ideaPool: readonly GiftIdea[];
  fixedRecipient?: PartyOption;
  startGiven?: boolean;
  /** A link or name the gift opens with, as when one is shared into the app. */
  startUrl?: string;
  startTitle?: string;
}) {
  const form = useDraftForm(
    () =>
      giftCaptureDraftOf({
        given: startGiven,
        url: startUrl,
        title: startTitle,
      }),
    (draft) => giftCaptureInputOf(draft, ideaPool, fixedRecipient),
  );
  const { update } = form;
  return {
    ...form,
    chosen: new Set(form.fields.recipients.map((r) => partyKey(r.option))),
    addRecipient: (option: PartyOption) =>
      update((d) => ({
        ...d,
        recipients: [...d.recipients, newRecipientEntry(option)],
      })),
    removeRecipient: (key: string) =>
      update((d) => ({ ...d, recipients: removeRecipient(d.recipients, key) })),
    setRecipientGiven: (key: string, given: boolean) =>
      update((d) => ({
        ...d,
        recipients: patchRecipient(d.recipients, key, { given }),
      })),
  };
}
