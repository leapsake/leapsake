import type { Person } from "@leapsake/schema";

/**
 * A person's display name, "First Last". The middle name is intentionally
 * excluded — it appears only on the View page's field list and in the forms.
 */
export function fullName(person: Person): string {
  return `${person.firstName} ${person.lastName}`;
}
