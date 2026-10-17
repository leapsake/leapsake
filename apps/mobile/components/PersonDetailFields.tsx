import {
  type Gender,
  type Person,
  countryName,
  genderLabel,
} from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { DetailField } from "./DetailField";

/** A person's name parts, gender and affiliations, read-only, edited
 *  together. */
export function PersonDetailFields({
  person,
  gender,
}: {
  person: Person;
  /** The gender to show, perhaps derived; the form seeds from the stored one,
   *  or an inference would be frozen into a fact. */
  gender: Gender | null;
}) {
  const m = useMessages();

  return (
    <>
      <DetailField label="First name" value={person.firstName ?? "—"} />
      <DetailField label="Middle name" value={person.middleName ?? "—"} />
      <DetailField label="Last name" value={person.lastName ?? "—"} />
      <DetailField
        label="Gender"
        value={gender === null ? "—" : genderLabel[gender]}
      />
      <DetailField
        label={m.affiliations.nationalities}
        value={
          person.nationalities.length === 0
            ? "—"
            : m.affiliations.list(person.nationalities.map(countryName))
        }
      />
      <DetailField
        label={m.affiliations.religions}
        value={
          person.religions.length === 0
            ? "—"
            : m.affiliations.list(
                person.religions.map((r) => m.affiliations.religion[r]),
              )
        }
      />
    </>
  );
}
