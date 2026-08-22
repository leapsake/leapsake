import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { ContactMethod } from "@leapsake/schema";
import { useHeaderSave } from "../../../../../components/HeaderSave";
import {
  ContactMethodFields,
  contactDraftFrom,
  contactDraftToValue,
  contactDraftValid,
} from "../../../../../components/ContactMethodFields";
import { updateContact } from "../../../../../lib/contact-writes";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

const TITLE = "Edit contact";

/**
 * Revise one of a person's contact methods — the **Edit** in that row's `⋯`
 * sheet.
 *
 * The id alone addresses it: the loaded method carries its own kind, so the
 * route needs no `[kind]` segment even though the write behind it is
 * per-table ({@link updateContact}).
 */
export default function ContactEditScreen() {
  const core = useCore();
  const { id, cid } = useLocalSearchParams<{ id: string; cid: string }>();
  // There is no `core.contactMethods.get`; load the owner's merged methods and
  // find this one — the same union the section renders.
  const load = useCallback(
    () => core.contactMethods.listForOwner("person", id),
    [core, id],
  );
  const { data: methods, error } = useFocusedData(load);
  const entry = methods?.find((m) => m.method.id === cid);

  // The form declares the header (title + Save) itself, so the title is set here
  // only for the branches where it isn't mounted yet. Two `Stack.Screen`s for one
  // route would otherwise race over the same options.
  if (error !== null || methods === null || entry === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: TITLE }} />
        <View style={styles.screen}>
          {error !== null ? (
            <Text style={styles.danger}>{error}</Text>
          ) : methods === null ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.danger}>Contact not found.</Text>
          )}
        </View>
      </>
    );
  }

  return <ContactEditForm cid={cid} entry={entry} />;
}

function ContactEditForm({
  cid,
  entry,
}: {
  cid: string;
  entry: ContactMethod;
}) {
  const core = useCore();
  const router = useRouter();
  // Seeded once: the loader above re-runs on focus and on a background pull, and
  // a form reseeded mid-edit would discard what the user had typed.
  const [draft, setDraft] = useState(() => contactDraftFrom(entry));
  const [saving, setSaving] = useState(false);

  const canSave = !saving && contactDraftValid(draft);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await updateContact(core, cid, contactDraftToValue(draft));
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
  const options = useMemo(() => ({ title: TITLE, headerRight }), [headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        {/* No Type dropdown: a phone number that should have been an email is a
            new row, not an edit — the two live in different tables and share no
            id. A saved social row gets a Platform field in its place. */}
        <ContactMethodFields draft={draft} onChange={setDraft} />
      </ScrollView>
    </>
  );
}
