import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { PersonView } from "@leapsake/core";
import { usePersonForm } from "@leapsake/ui/headless";
import { useHeaderSave } from "../../../components/HeaderSave";
import { PersonFields } from "../../../components/PersonFields";
import { tagsRawOf } from "../../../components/TagsInput";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import { styles } from "../../../lib/styles";
import { LoadState } from "../../../components/LoadState";
import { FormScrollView } from "../../../components/FormScrollView";

const TITLE = "Edit details";

const TEXT = {
  saveFailed: "Couldn’t save",
  nameRequired: "Enter a first, middle or last name before saving.",
} as const;

/** A person's own fields, their name and gender, with a Save of their own. */
export default function PersonEditScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Wrapped: a missing record and a load in flight are both `null` otherwise.
  const load = useCallback(
    async () => ({ view: await core.views.person(id) }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
  if (error !== null || data === null || data.view === null) {
    return (
      <LoadState
        error={error}
        loading={data === null}
        missing="Person not found."
        header={{ title: TITLE }}
      />
    );
  }

  return <PersonEditForm id={id} view={data.view} />;
}

function PersonEditForm({ id, view }: { id: string; view: PersonView }) {
  const core = useCore();
  const router = useRouter();
  // Seeded once, so a reload cannot discard typing. The stored gender, not the
  // derived one; tags ride along, since `update` replaces them.
  const form = usePersonForm(view.person, tagsRawOf(view.tags));
  const [saving, setSaving] = useState(false);

  async function save() {
    const shaped = form.submit();
    if (shaped === null || saving) return;
    setSaving(true);
    try {
      await core.people.update(id, shaped.input, shaped.tags);
      router.back();
    } catch (e) {
      Alert.alert(TEXT.saveFailed, String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    problem: form.errors.name === "required" ? TEXT.nameRequired : undefined,
    saving,
    onPress: () => void save(),
  });
  const options = useMemo(() => ({ title: TITLE, headerRight }), [headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <FormScrollView contentContainerStyle={styles.screen}>
        <PersonFields
          draft={form.fields}
          onChange={(draft) => form.update(() => draft)}
        />
      </FormScrollView>
    </>
  );
}
