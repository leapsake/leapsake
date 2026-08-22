import { type Gender, type Person, genderLabel } from "@leapsake/schema";
import { DetailField } from "./DetailField";

/**
 * A person's own scalar fields at the top of their detail screen — the name
 * parts, then gender — read only.
 *
 * All four move together, behind the one **Edit** on the section header above
 * them (`app/people/[id]/edit.tsx`). They each had an Edit and a Save of their
 * own once, which made fixing a spelling three taps and made the top of the page
 * a column of buttons; a name is one thought, not three or four.
 */
export function PersonDetailFields({
  person,
  gender,
}: {
  person: Person;
  /**
   * The gender to *show*, which may have been derived from this person's
   * relationships rather than stored on them. The form seeds from the stored
   * `person.gender` instead — a derived value is not this person's to revise,
   * and writing it there would freeze an inference into a fact.
   */
  gender: Gender | null;
}) {
  return (
    <>
      <DetailField label="First name" value={person.firstName ?? "—"} />
      <DetailField label="Middle name" value={person.middleName ?? "—"} />
      <DetailField label="Last name" value={person.lastName ?? "—"} />
      <DetailField
        label="Gender"
        value={gender === null ? "—" : genderLabel[gender]}
      />
    </>
  );
}
