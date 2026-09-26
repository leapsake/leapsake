import type { GiftIdea, GiftIdeaDraft, SearchHit } from "@leapsake/schema";
import { useGiftIdeaForm } from "../../headless/index.js";
import { useMessages } from "../../messages/index.js";
import { ChipTextField } from "../fields/ChipTextField.js";
import { FormShell } from "../patterns/FormShell.js";
import { StackedField } from "../primitives/Field.js";

/**
 * The create/edit form for a GiftIdea: {@link useGiftIdeaForm}'s draft rendered by
 * {@link GiftIdeaFields}. With JS, Save waits for a title; without it, `required` does.
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
  const form = useGiftIdeaForm(idea, tagNames);

  return (
    <FormShell
      submitLabel={m.common.save}
      cancelTo={cancelTo}
      submitting={submitting}
      canSubmit={form.canSubmit}
    >
      <GiftIdeaFields fields={form.fields} set={form.set} search={search} />
    </FormShell>
  );
}

/** A gift idea's fields, posted under the names the write path reads. */
export function GiftIdeaFields({
  fields,
  set,
  search,
}: {
  fields: GiftIdeaDraft;
  set: <K extends keyof GiftIdeaDraft>(key: K, value: GiftIdeaDraft[K]) => void;
  search: (query: string) => Promise<SearchHit[]>;
}) {
  const m = useMessages();

  return (
    <>
      <StackedField label={m.giftIdeaForm.title}>
        <input
          name="title"
          value={fields.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={m.giftIdeaForm.titlePlaceholder}
          required
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.url}>
        <input
          name="url"
          type="url"
          value={fields.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder={m.giftIdeaForm.urlPlaceholder}
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.notes}>
        <textarea
          name="notes"
          rows={4}
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={m.giftIdeaForm.notesPlaceholder}
        />
      </StackedField>
      <StackedField label={m.giftIdeaForm.tags}>
        <ChipTextField
          name="tags"
          grammar="tags"
          value={fields.tags}
          onChange={(tags) => set("tags", tags)}
          search={search}
          placeholder={m.giftIdeaForm.tagsPlaceholder}
        />
      </StackedField>
    </>
  );
}
