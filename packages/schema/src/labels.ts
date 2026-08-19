import type { Person } from "./person.js";
import type { Pet } from "./pet.js";
import type { EntityType } from "./relationship.js";

/**
 * Join whatever name parts are actually there, single-spaced.
 *
 * Every part of a person's name is optional (see {@link Person}), so the parts
 * can no longer be interpolated into a template — a surname-only person would
 * render as `" Davis"` with a leading space, and sort and match on it. This is
 * the one place that knows how to put the pieces back together, and it is
 * exported because several callers assemble names from raw *rows* rather than
 * from a `Person` (the search index, the duplicate scorer).
 */
export function joinNameParts(
  ...parts: readonly (string | null | undefined)[]
): string {
  return parts.filter((part) => part != null && part !== "").join(" ");
}

/**
 * A person's display name, "First Last". The middle name is intentionally
 * excluded — it appears only on the View page's field list and in the forms —
 * *unless* it is the only name there is, since a label that renders as the empty
 * string would leave the person unreadable on every screen at once.
 */
export function fullName(person: Person): string {
  const outer = joinNameParts(person.firstName, person.lastName);
  return outer === "" ? (person.middleName ?? "") : outer;
}

/**
 * Display label for any relationship-graph entity: a person's full name or a
 * pet's name. Used wherever relationship candidates and labels are built so the
 * two entity types render uniformly.
 */
export function entityLabel(type: EntityType, entity: Person | Pet): string {
  return type === "person" ? fullName(entity as Person) : (entity as Pet).name;
}

/**
 * A tag's display label: its bare stored name with the leading "#" sigil. The
 * "#" is presentation only (like a hashtag) — it's never stored on the tag, so
 * every place that shows a tag routes through here to render it uniformly.
 */
export function tagLabel(name: string): string {
  return `#${name}`;
}
