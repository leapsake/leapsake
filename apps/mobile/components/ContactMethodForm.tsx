import { useMemo, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack } from "expo-router";
import type {
  ContactMethodDraftErrors,
  ContactMethodValue,
} from "@leapsake/contact-links";
import type { ContactMethod, ContactMethodKind } from "@leapsake/schema";
import { useContactMethodForm } from "@leapsake/ui/headless";
import { ContactMethodFields } from "./ContactMethodFields";
import { useHeaderSave } from "./HeaderSave";
import { styles } from "../lib/styles";

const TEXT = {
  saveFailed: "Couldn’t save",
  labelRequired: "Give it a label before saving, like “Home”.",
  addressRequired: "Enter the email address before saving.",
  numberRequired: "Enter the phone number before saving.",
  line1Required: "Enter the first line of the address before saving.",
  platformRequired: "Name the platform before saving.",
  handleRequired: "Enter a handle or a profile link before saving.",
} as const;

/**
 * One contact method on a screen of its own: {@link useContactMethodForm}'s draft
 * rendered by {@link ContactMethodFields}, with Save in the native header.
 */
export function ContactMethodForm({
  title,
  start,
  canChangeKind = false,
  onSubmit,
}: {
  /** The native header title, set here so it's declared in one place. */
  title: string;
  /** The saved method being edited, or the kind a new one starts as. */
  start?: ContactMethodKind | ContactMethod;
  canChangeKind?: boolean;
  onSubmit: (value: ContactMethodValue) => Promise<void>;
}) {
  const form = useContactMethodForm(start);
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    const shaped = form.submit();
    if (shaped === null || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(shaped.input);
    } catch (e) {
      Alert.alert(TEXT.saveFailed, String(e));
      setSubmitting(false);
    }
  }

  const headerRight = useHeaderSave({
    problem: contactMethodProblem(form.errors),
    saving: submitting,
    onPress: () => void save(),
  });
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <ContactMethodFields
          canChangeKind={canChangeKind}
          draft={form.fields}
          onChange={(draft) => form.update(() => draft)}
          setKind={form.setKind}
        />
      </ScrollView>
    </>
  );
}

function contactMethodProblem(
  errors: ContactMethodDraftErrors,
): string | undefined {
  if (errors.label) return TEXT.labelRequired;
  if (errors.address) return TEXT.addressRequired;
  if (errors.number) return TEXT.numberRequired;
  if (errors.line1) return TEXT.line1Required;
  if (errors.platform) return TEXT.platformRequired;
  if (errors.handle) return TEXT.handleRequired;
  return undefined;
}
