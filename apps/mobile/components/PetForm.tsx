import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { type CreatePetInput, type Gender, type Pet } from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { HeaderSave } from "./HeaderSave";
import { TagsInput } from "./TagsInput";
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
 * The pet fields alone, controlled by whoever owns the draft — the mirror of
 * {@link PersonFields}, and split out for the same reason.
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
        value={draft.gender}
        onChange={(value) => set("gender", value)}
      />
    </>
  );
}

/**
 * The **edit** form for a pet, ported from the desktop `PetForm` and mirroring
 * mobile's {@link PersonForm} — including the header-owned Save, and including
 * that creation now lives in app/add.tsx rather than here.
 */
export function PetForm({
  title,
  pet,
  tagNames = "",
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  pet?: Pet;
  /** Space-separated existing tag labels. */
  tagNames?: string;
  onSubmit: (input: CreatePetInput, tagsRaw: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PetDraft>(() =>
    pet === undefined ? emptyPetDraft() : petDraftFrom(pet, tagNames),
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = petDraftValid(draft);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(petDraftToInput(draft), draft.tags);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={submitting}
              onPress={() => void handleSubmit()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <PetFields draft={draft} onChange={setDraft} />
        <TagsInput
          value={draft.tags}
          onChange={(value) => setDraft({ ...draft, tags: value })}
        />
      </ScrollView>
    </>
  );
}
