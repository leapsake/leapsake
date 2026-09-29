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
      {/* E2E anchors: an empty `TextInput` has no accessibility text, and
          position misses once the keyboard reflows the form. */}
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
