import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import {
  type CreatePersonInput,
  type Gender,
  type Person,
} from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { ChipTextField } from "./ChipTextField";
import { HeaderSave } from "./HeaderSave";
import { colors, styles } from "../lib/styles";

/**
 * A person's fields as the UI holds them: every value a string or a nullable
 * enum, nothing trimmed or parsed yet. The **draft** is the unit both callers
 * share — {@link PersonForm} (edit) keeps one in its own state, and the combined
 * create screen (app/add.tsx) keeps one alongside a pet draft and its staged
 * extras, so it can hand the whole thing to `core.people.create` on Save.
 */
export interface PersonDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: Gender | null;
  /** Space-separated tag labels, exactly as typed; the screen runs `parseTagNames`. */
  tags: string;
}

export function emptyPersonDraft(): PersonDraft {
  return {
    firstName: "",
    middleName: "",
    lastName: "",
    gender: null,
    tags: "",
  };
}

export function personDraftFrom(person: Person, tagNames: string): PersonDraft {
  return {
    firstName: person.firstName,
    middleName: person.middleName ?? "",
    lastName: person.lastName,
    gender: person.gender,
    tags: tagNames,
  };
}

/** Both names are required; everything else is optional. */
export function personDraftValid(draft: PersonDraft): boolean {
  return draft.firstName.trim().length > 0 && draft.lastName.trim().length > 0;
}

/** Trim and collapse the empty middle name to `null`, mirroring desktop. */
export function personDraftToInput(draft: PersonDraft): CreatePersonInput {
  const middleName = draft.middleName.trim();
  return {
    firstName: draft.firstName.trim(),
    middleName: middleName === "" ? null : middleName,
    lastName: draft.lastName.trim(),
    gender: draft.gender,
  };
}

/**
 * The person fields alone, controlled by whoever owns the draft. Split out of
 * {@link PersonForm} so the create screen can show them under its Person/Pet
 * toggle without also inheriting a second scroll view and a second Save.
 */
export function PersonFields({
  draft,
  onChange,
}: {
  draft: PersonDraft;
  onChange: (draft: PersonDraft) => void;
}) {
  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput
          style={styles.input}
          value={draft.firstName}
          onChangeText={(value) => set("firstName", value)}
          autoCapitalize="words"
          placeholder="First name"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Middle name</Text>
        <TextInput
          style={styles.input}
          value={draft.middleName}
          onChangeText={(value) => set("middleName", value)}
          autoCapitalize="words"
          placeholder="Middle name (optional)"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Last name</Text>
        <TextInput
          style={styles.input}
          value={draft.lastName}
          onChangeText={(value) => set("lastName", value)}
          autoCapitalize="words"
          placeholder="Last name"
          placeholderTextColor={colors.muted}
        />
      </View>

      <GenderField
        value={draft.gender}
        onChange={(value) => set("gender", value)}
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tags</Text>
        <ChipTextField
          grammar="tags"
          style={styles.input}
          value={draft.tags}
          onChangeText={(value) => set("tags", value)}
          placeholder="#Friend #Colleague"
        />
      </View>
    </>
  );
}

/**
 * The **edit** form for a person, ported from the desktop `PersonForm`. Creation
 * no longer comes through here: app/add.tsx owns it, because a create form also
 * carries the Person/Pet toggle and the staged milestones/contacts/holidays that
 * an edit screen has no use for (the detail page's own sections handle those,
 * against a record that already exists).
 *
 * The form declares its own native header — title plus a right-aligned
 * {@link HeaderSave} — so the screen doesn't have to lift `canSubmit` out of it
 * just to render a header button. `expo-router` honours a `Stack.Screen`
 * anywhere in the screen's subtree.
 */
export function PersonForm({
  title,
  person,
  tagNames = "",
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  person?: Person;
  /** Space-separated existing tag labels. */
  tagNames?: string;
  onSubmit: (input: CreatePersonInput, tagsRaw: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PersonDraft>(() =>
    person === undefined
      ? emptyPersonDraft()
      : personDraftFrom(person, tagNames),
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = personDraftValid(draft);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(personDraftToInput(draft), draft.tags);
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
        <PersonFields draft={draft} onChange={setDraft} />
      </ScrollView>
    </>
  );
}
