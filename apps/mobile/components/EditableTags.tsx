import { useState } from "react";
import type { Tag } from "@leapsake/schema";
import { parseTagNames, tagLabel } from "@leapsake/schema";
import { EditableField } from "./EditableField";
import { TagsField } from "./TagsField";
import { TagsInput } from "./TagsInput";

/**
 * The Tags field on a Person or Pet detail screen, editable in place: the linked
 * tag list, over the same space-separated input the create screen uses.
 *
 * It stands apart from {@link PersonDetailFields} and {@link PetDetailFields}
 * for two reasons. Tagging is the same act whichever entity is being tagged, so
 * there is nothing to say twice; and the row belongs *below* the sections it
 * follows on both screens — tags describe a person you have already read, so
 * they close the page rather than open it, the same reading order the create
 * screen puts them in.
 */
export function EditableTags({
  tags,
  onSave,
}: {
  tags: readonly Tag[];
  /** Sets the entity's tags to exactly these names. */
  onSave: (tagNames: string[]) => Promise<void>;
}) {
  const tagsRaw = tags.map((tag) => tagLabel(tag.name)).join(" ");
  const [editing, setEditing] = useState(false);
  // Seeded on open, not on mount: the screen refetches on focus and after every
  // save, so a draft held from mount would be editing a stale list.
  const [draft, setDraft] = useState(tagsRaw);

  return (
    <EditableField
      label="Tags"
      editing={editing}
      onOpen={() => {
        setDraft(tagsRaw);
        setEditing(true);
      }}
      onClose={() => setEditing(false)}
      onSave={() => onSave(parseTagNames(draft))}
      edit={<TagsInput value={draft} onChange={setDraft} />}
    >
      <TagsField tags={tags} />
    </EditableField>
  );
}
