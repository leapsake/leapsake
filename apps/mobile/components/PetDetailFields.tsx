import { type Gender, type Pet, genderLabel } from "@leapsake/schema";
import { DetailField } from "./DetailField";

/** A pet's name and gender, read-only, as {@link PersonDetailFields}. */
export function PetDetailFields({
  pet,
  gender,
}: {
  pet: Pet;
  /** The gender to show, possibly derived — see {@link PersonDetailFields}. */
  gender: Gender | null;
}) {
  return (
    <>
      <DetailField label="Name" value={pet.name} />
      <DetailField
        label="Gender"
        value={gender === null ? "—" : genderLabel[gender]}
      />
    </>
  );
}
