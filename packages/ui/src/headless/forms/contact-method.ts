import {
  contactMethodDraftOf,
  contactMethodDraftWithKind,
  contactMethodInputOf,
} from "@leapsake/contact-links";
import type { ContactMethod, ContactMethodKind } from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The contact method form's state, starting from the method being edited or a blank kind. */
export function useContactMethodForm(
  start?: ContactMethodKind | ContactMethod,
) {
  const form = useDraftForm(
    () => contactMethodDraftOf(start),
    contactMethodInputOf,
  );
  const { update } = form;
  return {
    ...form,
    setKind: (kind: ContactMethodKind, platform?: string) =>
      update((draft) => contactMethodDraftWithKind(draft, kind, platform)),
  };
}
