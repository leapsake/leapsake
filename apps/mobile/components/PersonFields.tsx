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
 * enum, nothing trimmed or parsed yet. The **draft** is the unit both callers
 * share — the combined create screen (app/add.tsx) keeps one alongside a pet
 * draft and its staged extras, so it can hand the whole thing to
 * `core.people.create` on Save, and {@link PersonDetailFields} keeps one to seed
 * whichever group of fields is open for editing on the detail screen.
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
 * Valid once **any one** part of the name is filled in — "Jen" and "Jen Davis"
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
 * The three parts of a person's name, controlled by whoever owns the draft.
 * Split out from {@link PersonFields} because the detail screen edits the name
 * on its own, as one group: the rule they answer to — at least one part filled
 * in ({@link personDraftValid}) — spans all three, so they are the smallest set
 * that can be validated, and therefore saved, together.
 */
export function PersonNameFields({
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
    </>
  );
}

/**
 * Everything the create screen asks about a person up front — the name, then the
 * gender — controlled by whoever owns the draft. It is a create-time grouping:
 * on the detail screen these are separately editable fields, each saved on its
 * own (see {@link PersonDetailFields}).
 *
 * Tags are *not* here — they're {@link TagsInput}, rendered separately so the
 * add screen can keep them last, below its staged sections.
 */
export function PersonFields({
  draft,
  onChange,
}: {
  draft: PersonDraft;
  onChange: (draft: PersonDraft) => void;
}) {
  return (
    <>
      <PersonNameFields draft={draft} onChange={onChange} />
      <GenderField
        label="Gender"
        value={draft.gender}
        onChange={(gender) => onChange({ ...draft, gender })}
      />
    </>
  );
}
