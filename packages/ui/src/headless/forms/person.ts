import { type Person, personDraftOf, personInputOf } from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The person form's state, starting from the person being edited or from blanks. */
export function usePersonForm(
  person?: Pick<Person, "firstName" | "middleName" | "lastName" | "gender">,
  tags = "",
) {
  return useDraftForm(() => personDraftOf(person, tags), personInputOf);
}
