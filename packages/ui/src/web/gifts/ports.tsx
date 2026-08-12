import type {
  CaptureRecipient,
  GiftOccasion,
  GiftOccasionType,
  GiftParty,
  GiftPartyType,
} from "@leapsake/schema";
import { type ReactNode, createContext, useContext } from "react";
import type { PartialDate } from "../../headless/partial-date.js";

export type { PartialDate };

/**
 * One pickable occasion for a gift — a milestone of the recipient's, or a
 * holiday they observe.
 */
export interface GiftOccasionChoice {
  type: GiftOccasionType;
  id: string;
  label: string;
}

/** A person or pet a gift can be for. */
export interface PartyOption {
  type: GiftPartyType;
  id: string;
  label: string;
}

/**
 * A giving of an idea to someone — what the “✓ given” rows and the re-gift guard
 * read.
 *
 * Declared structurally, listing only the fields these components render, rather
 * than importing `@leapsake/core`'s `GiftForRecipient`. Core's type stays
 * assignable to it, and the package stays off the data layer — the same choice
 * `GenderResult` and `BearerHoliday` make.
 */
export interface GivenRow extends PartialDate {
  id: string;
  giftIdeaId: string;
  ideaTitle: string;
  ideaUrl: string | null;
  giverLabel: string | null;
  occasionLabel: string | null;
  occasionType: GiftOccasionType | null;
  occasionId: string | null;
}

/** A suggestion of an idea for someone, from the recipient's end. */
export interface SuggestionRow {
  id: string;
  giftIdeaId: string;
  ideaTitle: string;
  ideaUrl: string | null;
  occasionLabel: string | null;
  occasionType: GiftOccasionType | null;
  occasionId: string | null;
  targetYear: number | null;
  targetMonth: number | null;
  targetDay: number | null;
}

/** The same suggestion seen from the idea's end, where the recipient is what varies. */
export interface IdeaSuggestionRow extends Omit<
  SuggestionRow,
  "ideaTitle" | "ideaUrl"
> {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
}

/** What one submit of the capture form writes, in one transaction. */
export interface GiftCaptureInput {
  giftIdea: { id: string } | { title: string; url?: string };
  recipients: CaptureRecipient[];
}

/**
 * Everything the gift surfaces need from the application: the reads that fill
 * their pickers and the writes they perform.
 *
 * Supplied through context rather than props because four screens render gift
 * components — a person, a pet, the gift-idea editor and the standalone create
 * screen — and the components nest three deep. Threading nine functions through
 * that by hand would put most of them on components that only forward them.
 *
 * This is the same shape as the repo's other ports (`SqliteDriver`, `KeyStore`,
 * `ImportPorts`): an interface the composition root implements, here over
 * `window.api` on desktop and over whatever the web app's transport turns out to
 * be.
 */
export interface GiftsPorts {
  /** Occasions this party can name — their milestones plus holidays they observe. */
  loadOccasions(party: GiftParty): Promise<GiftOccasionChoice[]>;
  /** What this party has already been given; the re-gift guard's source. */
  loadGiven(party: GiftParty): Promise<GivenRow[]>;
  /**
   * The real date(s) a holiday falls on in a year. A lunisolar holiday can fall
   * **twice** in one Gregorian year, so this returns every occurrence and the UI
   * assumes none of them.
   */
  loadOccurrences(holidayId: string, year: number): Promise<string[]>;
  capture(input: GiftCaptureInput): Promise<unknown>;
  createSuggestion(input: {
    giftIdeaId: string;
    recipientType: GiftPartyType;
    recipientId: string;
  }): Promise<unknown>;
  updateSuggestion(
    id: string,
    patch: { occasion: GiftOccasion | null; targetDate: PartialDate | null },
  ): Promise<unknown>;
  removeSuggestion(id: string): Promise<unknown>;
  updateGiving(
    id: string,
    patch: { occasion: GiftOccasion | null; date: PartialDate | null },
  ): Promise<unknown>;
  removeGiving(id: string): Promise<unknown>;
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
