import { type Gender, type Person, genderLabel } from "@leapsake/schema";
import { DetailField } from "./DetailField";

/**
 * A person's own scalar fields at the top of their detail screen — the name
 * parts, then gender — read only.
 *
 * They were editable in place for a while, each field with its own Edit and its
 * own Save, and the sections below them wrote from their rows the same way. That
 * is gone: the screen now has one **Edit** in its header, opening a form over the
 * whole record ({@link EntityEditForm}). A page that can be changed in a dozen
 * places is a page you cannot cancel, and revising a person is usually more than
 * one field's worth of thought — the name you fix is the same visit as the
 * birthday you were actually there for.
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
