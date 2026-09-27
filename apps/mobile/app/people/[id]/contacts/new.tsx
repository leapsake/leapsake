import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactMethodForm } from "../../../../components/ContactMethodForm";
import { createContact } from "../../../../lib/contact-writes";
import { useCore } from "../../../../lib/core-context";

/**
 * Add one contact method to a person. The route has no `[kind]`: the form's Type
 * dropdown picks it, so the user isn't asked to classify before typing.
 */
export default function ContactNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ContactMethodForm
      title="Add contact method"
      canChangeKind
      onSubmit={async (value) => {
        await createContact(core, { ownerType: "person", ownerId: id }, value);
        router.back();
      }}
    />
  );
}
