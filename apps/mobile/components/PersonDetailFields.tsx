import { type Gender, type Person, genderLabel } from "@leapsake/schema";
import { DetailField } from "./DetailField";

/** A person's name parts and gender, read-only, edited together. */
export function PersonDetailFields({
  person,
  gender,
}: {
  person: Person;
  /** The gender to show, perhaps derived; the form seeds from the stored one,
   *  or an inference would be frozen into a fact. */
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
