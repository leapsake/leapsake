import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { ContactMethod } from "@leapsake/schema";
import { ContactMethodForm } from "../../../../../components/ContactMethodForm";
import { updateContact } from "../../../../../lib/contact-writes";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";

const TITLE = "Edit contact";

/** Revise one contact method; it carries its own kind, so the id suffices. */
export default function ContactEditScreen() {
  const core = useCore();
  const { id, cid } = useLocalSearchParams<{ id: string; cid: string }>();
  // There is no `core.contactMethods.get`, so find it among the owner's.
  const load = useCallback(
    () => core.contactMethods.listForOwner("person", id),
    [core, id],
  );
  const { data: methods, error } = useFocusedData(load);
  const entry = methods?.find((m) => m.method.id === cid);

  // The form declares the header itself; two `Stack.Screen`s would race.
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

  // Seeded once, so a reload cannot discard typing. No Type dropdown: a
  // saved method's kind is its table.
  return (
    <ContactMethodForm
      title={TITLE}
      start={entry}
      onSubmit={async (value) => {
        await updateContact(core, cid, value);
        router.back();
      }}
    />
  );
}
