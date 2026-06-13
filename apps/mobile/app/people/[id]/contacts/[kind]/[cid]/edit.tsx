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

  return (
    <>
      <Stack.Screen options={{ title: "Edit contact" }} />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : methods === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : entry === undefined ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>Contact not found.</Text>
        </View>
      ) : (
        <ContactMethodForm
          kind={entry.kind}
          method={entry.method}
          submitLabel="Save"
          onCancel={() => router.back()}
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
      )}
    </>
  );
}
