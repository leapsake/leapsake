import type { GiftsPorts } from "@leapsake/ui/web";

/**
 * Desktop's implementation of `@leapsake/ui`'s gift ports — every write the gift
 * surfaces need, forwarded to the typed IPC bridge.
 *
 * Defined at module scope so its methods keep a stable identity across renders.
 * It used to carry three reads as well, filling the occasion picker and the
 * re-gift guard; occasions left v0.1 scope, and the guard is now structural.
 */
export const desktopGiftsPorts: GiftsPorts = {
  capture: (input) => window.api.gifts.capture(input),
  attachRecipient: (input) => window.api.gifts.recipients.create(input),
  setGiven: (id, given) => window.api.gifts.recipients.update(id, { given }),
  detachRecipient: (id) => window.api.gifts.recipients.softDelete(id),
};
