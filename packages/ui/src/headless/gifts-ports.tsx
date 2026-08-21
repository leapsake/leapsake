/**
 * The gift feature's ports — everything the gift surfaces need from the
 * application, as one interface the host app implements.
 *
 * Neutral rather than DOM: it is types plus a React context, so a React Native
 * renderer reads the same interface a web one does. The provider's JSX renders a
 * context, never a host element, which is why this is the one `.tsx` here.
 */
import type { GiftPartyType } from "@leapsake/schema";
import { type ReactNode, createContext, useContext } from "react";

/** A person or pet a gift can be for. */
export interface PartyOption {
  type: GiftPartyType;
  id: string;
  label: string;
}

/**
 * One gift idea a party is down for, from the **party's** end — what a person's
 * or pet's Gifts section lists.
 *
 * Declared structurally, listing only the fields these components render, rather
 * than importing `@leapsake/core`'s `GiftForRecipient`. Core's type stays
 * assignable to it, and the package stays off the data layer — the same choice
 * `GenderResult` and `BearerHoliday` make.
 */
export interface GiftRecipientRow {
  id: string;
  giftIdeaId: string;
  ideaTitle: string;
  ideaUrl: string | null;
  /** When the box was ticked; `null` while it is still outstanding. Read as a
   *  boolean — it is a stamp, not a date anyone typed. */
  givenAt: number | null;
}

/** The same link seen from the **idea's** end, where the party is what varies. */
export interface IdeaRecipientRow {
  id: string;
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  givenAt: number | null;
}

/** What one submit of the capture form writes, in one transaction. */
export interface GiftCaptureInput {
  giftIdea: { id: string } | { title: string; url?: string };
  recipients: {
    party: { type: GiftPartyType; id: string };
    given?: boolean;
  }[];
}

/**
 * Everything the gift surfaces need from the application: one read-free capture
 * and the three edits a link supports.
 *
 * Supplied through context rather than props because four screens render gift
 * components — a person, a pet, the gift-idea editor and the standalone create
 * screen — and the components nest two deep.
 *
 * This is the same shape as the repo's other ports (`SqliteDriver`, `KeyStore`,
 * `ImportPorts`): an interface the composition root implements — over
 * `window.api` on desktop, over an in-process `CoreApi` on mobile, and over
 * whatever the web app's transport turns out to be.
 *
 * It used to carry three reads as well (`loadOccasions`, `loadGiven`,
 * `loadOccurrences`), which filled the occasion picker and the re-gift guard.
 * Occasions are gone, and the guard is now structural: a party already down for
 * an idea is already in the list, with their state showing, so there is nothing
 * to warn about.
 */
export interface GiftsPorts {
  capture(input: GiftCaptureInput): Promise<unknown>;
  attachRecipient(input: {
    giftIdeaId: string;
    party: { type: GiftPartyType; id: string };
  }): Promise<unknown>;
  /** Tick or untick one link. Safe to call with the state it already has. */
  setGiven(id: string, given: boolean): Promise<unknown>;
  detachRecipient(id: string): Promise<unknown>;
}

const GiftsPortsContext = createContext<GiftsPorts | null>(null);

/** Supplies the application's gift reads and writes to the gift components. */
export function GiftsPortsProvider({
  ports,
  children,
}: {
  ports: GiftsPorts;
  children: ReactNode;
}) {
  return (
    <GiftsPortsContext.Provider value={ports}>
      {children}
    </GiftsPortsContext.Provider>
  );
}

/** Read the application's gift ports. Throws when none is mounted. */
export function useGiftsPorts(): GiftsPorts {
  const ports = useContext(GiftsPortsContext);
  if (ports === null) {
    throw new Error(
      "@leapsake/ui: no GiftsPortsProvider found. Wrap the app in <GiftsPortsProvider ports={…}> — see packages/ui/README.md.",
    );
  }
  return ports;
}
