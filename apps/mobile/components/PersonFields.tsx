import { Text, TextInput, View } from "react-native";
import type { PersonDraft } from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { styles } from "../lib/styles";

/**
 * A person's three name parts and gender, controlled by whoever owns the draft.
 * Tags are {@link TagsInput}, rendered apart so a form can keep them last.
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
