import { type Gender, type Pet, genderLabel } from "@leapsake/schema";
import { DetailField } from "./DetailField";

/**
 * A pet's own scalar fields at the top of their detail screen — the mirror of
 * {@link PersonDetailFields}, and read it for why these are read-only. A pet's
 * name is one field rather than three.
 */
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
