import { useMemo, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderSave } from "../../../../components/HeaderSave";
import {
  ContactMethodFields,
  contactDraftToValue,
  contactDraftValid,
  emptyContactDraft,
} from "../../../../components/ContactMethodFields";
import { createContact } from "../../../../lib/contact-writes";
import { useCore } from "../../../../lib/core-context";
import { styles } from "../../../../lib/styles";

/**
 * Add one contact method to a person — the screen behind the Contact section's
 * **Add contact method**.
 *
 * There is no `[kind]` in the route. The fields carry a Type dropdown of their
 * own, so the kind is picked here rather than on the way here, and the four
 * links this replaced asked the user to classify what they were about to type
 * before they had typed it.
 */
export default function ContactNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Nothing to load, so the draft opens empty and the form is mounted from the
  // first frame — this route never needs a header of its own.
  const [draft, setDraft] = useState(emptyContactDraft);
  const [saving, setSaving] = useState(false);

  const canSave = !saving && contactDraftValid(draft);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await createContact(
        core,
        { ownerType: "person", ownerId: id },
        contactDraftToValue(draft),
      );
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    canSave,
    saving,
    onPress: () => void save(),
  });
  const options = useMemo(
    () => ({ title: "Add contact method", headerRight }),
    [headerRight],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        {/* The first thing asked, because everything below it depends on the
            answer. */}
        <ContactMethodFields canChangeKind draft={draft} onChange={setDraft} />
      </ScrollView>
    </>
  );
}
