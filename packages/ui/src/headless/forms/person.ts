import { type Person, personDraftOf, personInputOf } from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The person form's state, from the person being edited or blanks. */
export function usePersonForm(
  person?: Pick<Person, "firstName" | "middleName" | "lastName" | "gender">,
  tags = "",
) {
  return useDraftForm(() => personDraftOf(person, tags), personInputOf);
}
