import { Text, TextInput, View } from "react-native";
import type { PetDraft } from "@leapsake/schema";
import { GenderField } from "./GenderField";
import { styles } from "../lib/styles";

/** A pet's name and gender, controlled by whoever owns the draft. */
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
      {/* An E2E anchor, as in {@link PersonFields}. */}
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
