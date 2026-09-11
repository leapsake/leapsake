import { Text, TextInput, View } from "react-native";
import {
  type CreatePersonInput,
  type Gender,
  type Person,
  hasAnyName,
} from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { styles } from "../lib/styles";

/**
 * A person's fields as the UI holds them: every value a string or a nullable
 * enum, nothing trimmed or parsed yet. The **draft** is the unit both entity
 * forms share, as one third of an {@link EntityFormValue}: the create screen
 * hands it to `core.people.create` on Save, and the edit screen seeds it from a
 * saved person and hands it to `core.people.update`.
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
    firstName: person.firstName ?? "",
    middleName: person.middleName ?? "",
    lastName: person.lastName ?? "",
    gender: person.gender,
    tags: tagNames,
  };
}

/**
 * Valid once **any one** part of the name is filled in — "Ruth" and "Ruth Dakin"
 * are both whole people (see `hasAnyName`). Asked of the input the form would
 * actually send rather than of the draft, so the button can never enable a save
 * the schema is about to reject.
 */
export function personDraftValid(draft: PersonDraft): boolean {
  return hasAnyName(personDraftToInput(draft));
}

/** Trim, collapsing an untouched field to `null` — the schema's "absent". */
function trimmed(value: string): string | null {
  const text = value.trim();
  return text === "" ? null : text;
}

export function personDraftToInput(draft: PersonDraft): CreatePersonInput {
  return {
    firstName: trimmed(draft.firstName),
    middleName: trimmed(draft.middleName),
    lastName: trimmed(draft.lastName),
    gender: draft.gender,
  };
}

/**
 * Everything a person form asks up front — the three parts of a name, then the
 * gender — controlled by whoever owns the draft. The name parts belong together
 * because the rule they answer to spans all three: at least one filled in
 * ({@link personDraftValid}).
 *
 * Tags are *not* here — they're {@link TagsInput}, rendered separately so the
 * form can keep them last, below its staged sections.
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
      {/*
        `testID`s here are load-bearing for the harness, not decoration — the
        same anchor set `account-*` joined. An empty `TextInput` carries no
        accessibility text, so a driver can only reach these by their *position*
        relative to the label above them; on the add screen, where the keyboard
        reflows a long form as it opens, that resolved to the wrong field or to
        nothing about half the time, and the typing landed silently elsewhere.
      */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput
          testID="person-first-name"
          style={styles.input}
          value={draft.firstName}
          onChangeText={(value) => set("firstName", value)}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Middle name (optional)</Text>
        <TextInput
          testID="person-middle-name"
          style={styles.input}
          value={draft.middleName}
          onChangeText={(value) => set("middleName", value)}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Last name</Text>
        <TextInput
          testID="person-last-name"
          style={styles.input}
          value={draft.lastName}
          onChangeText={(value) => set("lastName", value)}
          autoCapitalize="words"
        />
      </View>

      <GenderField
        label="Gender"
        value={draft.gender}
        onChange={(gender) => set("gender", gender)}
      />
    </>
  );
}
