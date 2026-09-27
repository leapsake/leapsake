import { type Pet, petDraftOf, petInputOf } from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The pet form's state, starting from the pet being edited or from blanks. */
export function usePetForm(pet?: Pick<Pet, "name" | "gender">, tags = "") {
  return useDraftForm(() => petDraftOf(pet, tags), petInputOf);
}
