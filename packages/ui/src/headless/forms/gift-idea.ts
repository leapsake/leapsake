import {
  type GiftIdea,
  giftIdeaDraftOf,
  giftIdeaInputOf,
} from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The gift idea form's state, from the idea being edited or blanks. */
export function useGiftIdeaForm(
  idea?: Pick<GiftIdea, "title" | "url" | "notes">,
  tags = "",
) {
  return useDraftForm(() => giftIdeaDraftOf(idea, tags), giftIdeaInputOf);
}
