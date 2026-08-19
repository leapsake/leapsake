import { Text, TextInput, View } from "react-native";
import { type CreatePetInput, type Gender, type Pet } from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { styles } from "../lib/styles";

/**
 * A pet's fields as the UI holds them — the pet half of the pair described on
 * {@link PersonDraft}. A pet is the simpler entity: one `name` rather than
 * first/middle/last, and no contact methods at all.
 */
export interface PetDraft {
  name: string;
  gender: Gender | null;
  /** Space-separated tag labels, exactly as typed; the screen runs `parseTagNames`. */
  tags: string;
}

export function emptyPetDraft(): PetDraft {
  return { name: "", gender: null, tags: "" };
}

export function petDraftFrom(pet: Pet, tagNames: string): PetDraft {
  return { name: pet.name, gender: pet.gender, tags: tagNames };
}

export function petDraftValid(draft: PetDraft): boolean {
  return draft.name.trim().length > 0;
}

export function petDraftToInput(draft: PetDraft): CreatePetInput {
  return { name: draft.name.trim(), gender: draft.gender };
}

/**
 * The pet fields the create screen asks for up front, controlled by whoever owns
 * the draft — the mirror of {@link PersonFields}, and grouped for the same
 * create-time reason. There is no name/gender split to make here: a pet's name
 * is one field, so the detail screen's name editor renders that input itself.
 */
export function PetFields({
  draft,
  onChange,
}: {
  draft: PetDraft;
  onChange: (draft: PetDraft) => void;
}) {
  const set = <K extends keyof PetDraft>(key: K, value: PetDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      {/* Load-bearing for the harness — see the note in {@link PersonFields}. */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          testID="pet-name"
          style={styles.input}
          value={draft.name}
          onChangeText={(value) => set("name", value)}
          autoCapitalize="words"
        />
      </View>

      <GenderField
        label="Gender"
        value={draft.gender}
        onChange={(value) => set("gender", value)}
      />
    </>
  );
}
