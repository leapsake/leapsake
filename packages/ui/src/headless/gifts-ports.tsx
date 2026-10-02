// The gift feature's ports; the provider renders only a context, never a host
// element, so this is platform-neutral despite being `.tsx`.
import type { GiftPartyType } from "@leapsake/schema";
import { type ReactNode, createContext, useContext } from "react";

/** A person or pet a gift can be for. */
export interface PartyOption {
  type: GiftPartyType;
  id: string;
  label: string;
}

/** One gift idea a party is down for, as their Gifts section lists it. */
export interface GiftRecipientRow {
  id: string;
  giftIdeaId: string;
  ideaTitle: string;
  ideaUrl: string | null;
  /** When the box was ticked, or `null`; read as a boolean, not a date. */
  givenAt: number | null;
}

/** The same link from the idea's end, where the party is what varies. */
export interface IdeaRecipientRow {
  id: string;
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  givenAt: number | null;
}

/** What one submit of the capture form writes, in one transaction. */
export interface GiftCaptureInput {
  giftIdea: { id: string } | { title: string; url?: string; imageUrl?: string };
  recipients: {
    party: { type: GiftPartyType; id: string };
    given?: boolean;
  }[];
}

/** Everything the gift surfaces need: one capture and a link's three edits. */
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
