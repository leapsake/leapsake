import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ContactMethodForm } from "../../../../../../components/ContactMethodForm";
import { useCore } from "../../../../../../lib/core-context";
import { useFocusedData } from "../../../../../../lib/useFocusedData";
import { styles } from "../../../../../../lib/styles";

export default function ContactEditScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, cid } = useLocalSearchParams<{ id: string; cid: string }>();
  // No `core.contactMethods.get`; load the owner's merged methods and find this
  // one — the same union the section renders — keeping `packages/*` untouched.
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
        <Stack.Screen options={{ title: "Edit contact" }} />
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

  return (
    <ContactMethodForm
      title="Edit contact"
      kind={entry.kind}
      method={entry.method}
      onSubmit={async (value) => {
        if (value.kind === "email") {
          await core.contactMethods.emails.update(cid, {
            label: value.label,
            address: value.address,
          });
        } else if (value.kind === "phone") {
          await core.contactMethods.phones.update(cid, {
            label: value.label,
            number: value.number,
            extension: value.extension,
            country: value.country,
            smsCapable: value.smsCapable,
          });
        } else {
          await core.contactMethods.postals.update(cid, {
            label: value.label,
            line1: value.line1,
            line2: value.line2,
            locality: value.locality,
            region: value.region,
            postalCode: value.postalCode,
            country: value.country,
          });
        }
        router.back();
      }}
    />
  );
}
