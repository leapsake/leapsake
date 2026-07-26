import type { GiftIdea } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";
import { FormShell } from "../patterns/FormShell.js";
import { StackedField } from "../primitives/Field.js";

/**
 * The shared create/edit form for a GiftIdea. Title is required; URL and Notes
 * are optional (the write path drops blanks to null). Uncontrolled inputs — the
 * values are read straight from `FormData` — since there's no typeahead or token
 * splicing to manage, unlike the reminder form.
 */
export function GiftIdeaForm({
  idea,
  tagNames = "",
  cancelTo = "/gifts",
  submitting,
}: {
  idea?: GiftIdea;
  /** Comma-separated existing tag names; empty on create. */
  tagNames?: string;
  /** Where Cancel returns to — the recipient's page when launched from there. */
  cancelTo?: string;
  submitting: boolean;
}) {
  const m = useMessages();

  return (
    <FormShell
      submitLabel={m.common.save}
      cancelTo={cancelTo}
      submitting={submitting}
    >
      <StackedField label={m.giftIdeaForm.title}>
        <input
          name="title"
          defaultValue={idea?.title ?? ""}
          placeholder={m.giftIdeaForm.titlePlaceholder}
          required
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.url}>
        <input
          name="url"
          type="url"
          defaultValue={idea?.url ?? ""}
          placeholder={m.giftIdeaForm.urlPlaceholder}
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.notes}>
        <textarea
          name="notes"
          rows={4}
          defaultValue={idea?.notes ?? ""}
          placeholder={m.giftIdeaForm.notesPlaceholder}
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.tags}>
        <input
          name="tags"
          defaultValue={tagNames}
          placeholder={m.giftIdeaForm.tagsPlaceholder}
        />
      </StackedField>
    </FormShell>
  );
}
