import { type PersonAffiliations, isAffiliated } from "./affiliation.js";
import { affiliationsFor, wishByDefaultFor } from "./catalog.js";
import type { Holiday, ObservanceBearerType } from "@leapsake/schema";

// Who observes a holiday: those who said so, and those it's implied for.

/** What implicit observance is read from: each living person's affiliations,
 *  and which person is you. */
export interface ImplicitObservance {
  people: ReadonlyMap<string, PersonAffiliations>;
  selfId: string | null;
  /** Where you live, for asking whether you keep a holiday before anyone is
   *  you. */
  yourCountry: string | null;
}

/** Nobody observes implicitly. */
export const NO_IMPLICIT: ImplicitObservance = {
  people: new Map(),
  selfId: null,
  yourCountry: null,
};

/** The key an observance is addressed by within one holiday. */
export function bearerKey(
  bearerType: ObservanceBearerType,
  bearerId: string,
): string {
  return `${bearerType}:${bearerId}`;
}

/** The bearer id a {@link bearerKey} was made from. */
export function keyId(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

/** The living people who keep a catalog holiday because an affiliation of
 *  theirs matches it, as bearer keys. */
export function implicitObservers(
  holiday: Pick<Holiday, "slug" | "origin">,
  implicit: ImplicitObservance,
): ReadonlySet<string> {
  const keptBy =
    holiday.origin === "catalog" ? affiliationsFor(holiday.slug) : null;
  const keys = new Set<string>();
  if (keptBy === null) return keys;
  for (const [personId, affiliations] of implicit.people)
    if (isAffiliated(keptBy, affiliations))
      keys.add(bearerKey("person", personId));
  return keys;
}

/** Everyone who observes a holiday: those who said so, and those it's
 *  implied for who haven't said otherwise. */
export function observersOf(
  holiday: Pick<Holiday, "slug" | "origin">,
  stored: readonly {
    bearerType: ObservanceBearerType;
    bearerId: string;
    observes: boolean;
  }[],
  implicit: ImplicitObservance,
): { bearerType: ObservanceBearerType; bearerId: string }[] {
  const said = new Set(stored.map((o) => bearerKey(o.bearerType, o.bearerId)));
  const implied = [...implicitObservers(holiday, implicit)]
    .filter((key) => !said.has(key))
    .map((key) => ({ bearerType: "person" as const, bearerId: keyId(key) }));
  return [...stored.filter((o) => o.observes), ...implied];
}

/** Whether a bearer's wish is on before any schedule is stored. You are never
 *  on your own wish list. */
export function wishByDefaultOf(
  holiday: Pick<Holiday, "slug" | "origin">,
  bearerId: string,
  implicit: ImplicitObservance,
): boolean {
  return (
    holiday.origin === "catalog" &&
    wishByDefaultFor(holiday.slug) &&
    bearerId !== implicit.selfId
  );
}
