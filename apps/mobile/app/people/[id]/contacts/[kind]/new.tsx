import { useLocalSearchParams, useRouter } from "expo-router";
import type { ContactMethodKind } from "@leapsake/schema";
import { ContactMethodForm } from "../../../../../components/ContactMethodForm";
import { useCore } from "../../../../../lib/core-context";

export default function ContactNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, kind } = useLocalSearchParams<{
    id: string;
    kind: ContactMethodKind;
  }>();

  // The form declares the header (title + Save) itself; nothing loads first here,
  // so it is mounted from the start and this screen never needs its own.
  return (
    <ContactMethodForm
      title={`Add ${kind}`}
      kind={kind}
      onSubmit={async (value) => {
        if (value.kind === "email") {
          await core.contactMethods.emails.create({
            ownerType: "person",
            ownerId: id,
            label: value.label,
            address: value.address,
          });
        } else if (value.kind === "phone") {
          await core.contactMethods.phones.create({
            ownerType: "person",
            ownerId: id,
            label: value.label,
            number: value.number,
            extension: value.extension,
            country: value.country,
            smsCapable: value.smsCapable,
          });
        } else {
          await core.contactMethods.postals.create({
            ownerType: "person",
            ownerId: id,
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
