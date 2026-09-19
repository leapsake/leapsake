import type { GiftsPorts } from "@leapsake/ui/web";

/** Every gift write, over IPC; module-scoped for a stable identity. */
export const desktopGiftsPorts: GiftsPorts = {
  capture: (input) => window.api.gifts.capture(input),
  attachRecipient: (input) => window.api.gifts.recipients.create(input),
  setGiven: (id, given) => window.api.gifts.recipients.update(id, { given }),
  detachRecipient: (id) => window.api.gifts.recipients.softDelete(id),
};
