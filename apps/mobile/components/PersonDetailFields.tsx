import { useState } from "react";
import { Text } from "react-native";
import {
  type Gender,
  type Person,
  type Tag,
  type UpdatePersonInput,
  genderLabel,
  parseTagNames,
  tagLabel,
} from "@leapsake/schema";
import { DetailField } from "./DetailField";
import { EditableField } from "./EditableField";
import { GenderField } from "./GenderField";
import {
  type PersonDraft,
  PersonNameFields,
  personDraftFrom,
  personDraftToInput,
  personDraftValid,
} from "./PersonFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** Which field is open for editing; one at a time, so a page of open drafts
 *  can't disagree about the same record. */
type Group = "name" | "gender";

/** The name third of the draft, trimmed by the form's own rules. */
function nameInput(draft: PersonDraft): UpdatePersonInput {
  const { firstName, middleName, lastName } = personDraftToInput(draft);
  return { firstName, middleName, lastName };
}

/**
 * A person's own scalar fields at the top of their detail screen — name and
 * gender — each read in place and each editable in place (see
 * {@link EditableField}). The related facts below them (contacts, milestones,
 * relationships, holidays, gifts) are their own sections and edit themselves;
 * tags close the page as an {@link EditableTags}.
 *
 * Grouping: the three parts of a name are one field here, because the rule that
 * governs them — at least one part must survive the edit (`hasAnyName`) — spans
 * all three, so they are the smallest set that can be validated, and therefore
 * saved, together. (This used to be a stronger claim: first and last were both
 * required. Only the grouping outlived that.) Gender stands alone.
 */
export function PersonDetailFields({
  person,
  gender,
  tags,
  onChanged,
}: {
  person: Person;
  /**
   * The gender to *show*, which may have been derived from this person's
   * relationships rather than stored on them. The editor seeds from the stored
   * `person.gender` instead — a derived value is not this person's to revise,
   * and writing it here would freeze an inference into a fact.
   */
  gender: Gender | null;
  tags: readonly Tag[];
  onChanged: () => void;
}) {
  const core = useCore();
  const tagsRaw = tags.map((tag) => tagLabel(tag.name)).join(" ");
  const [open, setOpen] = useState<Group | null>(null);
  const [draft, setDraft] = useState<PersonDraft>(() =>
    personDraftFrom(person, tagsRaw),
  );

  // Seeded on open rather than on mount: this screen refetches on focus and
  // after every save, so a draft held from mount would be editing a stale copy.
  function openGroup(group: Group) {
    setDraft(personDraftFrom(person, tagsRaw));
    setOpen(group);
  }

  // Tags ride along on every write, edited or not: `people.update` sets the
  // entity's tags to exactly what it is handed, so a name save that passed none
  // would clear them.
  async function save(input: UpdatePersonInput, rawTags: string) {
    await core.people.update(person.id, input, parseTagNames(rawTags));
    onChanged();
  }

  const close = () => setOpen(null);

  return (
    <>
      <EditableField
        label="Name"
        editing={open === "name"}
        onOpen={() => openGroup("name")}
        onClose={close}
        canSave={personDraftValid(draft)}
        onSave={() => save(nameInput(draft), tagsRaw)}
        edit={<PersonNameFields draft={draft} onChange={setDraft} />}
      >
        <DetailField label="First name" value={person.firstName ?? "—"} />
        <DetailField label="Middle name" value={person.middleName ?? "—"} />
        <DetailField label="Last name" value={person.lastName ?? "—"} />
      </EditableField>

      <EditableField
        label="Gender"
        editing={open === "gender"}
        onOpen={() => openGroup("gender")}
        onClose={close}
        onSave={() => save({ gender: draft.gender }, tagsRaw)}
        edit={
          <GenderField
            value={draft.gender}
            onChange={(value) => setDraft({ ...draft, gender: value })}
          />
        }
      >
        <Text style={styles.fieldValue}>
          {gender === null ? "—" : genderLabel[gender]}
        </Text>
      </EditableField>
    </>
  );
}
