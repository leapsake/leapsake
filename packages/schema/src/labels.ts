import type { Person } from "./person.js";
import type { Pet } from "./pet.js";
import type { EntityType } from "./relationship.js";

/**
 * A person's display name, "First Last". The middle name is intentionally
 * excluded — it appears only on the View page's field list and in the forms.
 */
export function fullName(person: Person): string {
  return `${person.firstName} ${person.lastName}`;
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
