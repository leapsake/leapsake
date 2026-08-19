import { useState } from "react";
import { Text, TextInput } from "react-native";
import {
  type Gender,
  type Pet,
  type Tag,
  type UpdatePetInput,
  genderLabel,
  parseTagNames,
  tagLabel,
} from "@leapsake/schema";
import { EditableField } from "./EditableField";
import { GenderField } from "./GenderField";
import {
  type PetDraft,
  petDraftFrom,
  petDraftToInput,
  petDraftValid,
} from "./PetFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

type Group = "name" | "gender";

/**
 * A pet's own scalar fields at the top of their detail screen — the mirror of
 * {@link PersonDetailFields}, and read it for the reasoning. A pet's name is a
 * single field, so its editor is the bare input rather than a group.
 */
export function PetDetailFields({
  pet,
  gender,
  tags,
  onChanged,
}: {
  pet: Pet;
  /** The gender to show, possibly derived — see {@link PersonDetailFields}. */
  gender: Gender | null;
  tags: readonly Tag[];
  onChanged: () => void;
}) {
  const core = useCore();
  const tagsRaw = tags.map((tag) => tagLabel(tag.name)).join(" ");
  const [open, setOpen] = useState<Group | null>(null);
  const [draft, setDraft] = useState<PetDraft>(() =>
    petDraftFrom(pet, tagsRaw),
  );

  function openGroup(group: Group) {
    setDraft(petDraftFrom(pet, tagsRaw));
    setOpen(group);
  }

  async function save(input: UpdatePetInput, rawTags: string) {
    await core.pets.update(pet.id, input, parseTagNames(rawTags));
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
        canSave={petDraftValid(draft)}
        onSave={() => save({ name: petDraftToInput(draft).name }, tagsRaw)}
        edit={
          // The same harness anchor the create screen's pet name carries — see
          // the note in `PersonNameFields`. The two never share a screen.
          <TextInput
            testID="pet-name"
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            autoCapitalize="words"
          />
        }
      >
        <Text style={styles.fieldValue}>{pet.name}</Text>
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
