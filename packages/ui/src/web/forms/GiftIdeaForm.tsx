import type { GiftIdea, SearchHit } from "@leapsake/schema";
import { useState } from "react";
import { useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import { FormShell } from "../patterns/FormShell.js";
import { StackedField } from "../primitives/Field.js";

/**
 * The shared create/edit form for a GiftIdea. Title is required; URL and Notes
 * are optional (the write path drops blanks to null). Title, URL and Notes are
 * uncontrolled — read straight from `FormData`, with no typeahead to manage —
 * while Tags is a {@link ChipTextField}, which chips each tag as it is typed.
 */
export function GiftIdeaForm({
  idea,
  tagNames = "",
  search,
  cancelTo = "/gifts",
  submitting,
}: {
  idea?: GiftIdea;
  /** Comma-separated existing tag names; empty on create. */
  tagNames?: string;
  /** Backs the Tags field's existing-tag picker; must be stable across renders. */
  search: (query: string) => Promise<SearchHit[]>;
  /** Where Cancel returns to — the recipient's page when launched from there. */
  cancelTo?: string;
  submitting: boolean;
}) {
  const m = useMessages();
  // Controlled, because the Tags field chips what it holds — see ChipTextField.
  const [tags, setTags] = useState(tagNames);

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
        <ChipTextField
          name="tags"
          grammar="tags"
          value={tags}
          onChange={setTags}
          search={search}
          placeholder={m.giftIdeaForm.tagsPlaceholder}
        />
      </StackedField>
    </FormShell>
  );
}
