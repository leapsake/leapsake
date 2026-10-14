import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  type EntityType,
  type CreatePersonInput,
  type CreatePetInput,
  entityLabel,
} from "@leapsake/schema";
import { FormScrollView } from "../components/FormScrollView";
import { useHeaderSave } from "../components/HeaderSave";
import { PersonFields } from "../components/PersonFields";
import { PetFields } from "../components/PetFields";
import { RecordFacts } from "../components/RecordFacts";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityDetailsOf,
  entityFormProblem,
  switchedEntityForm,
} from "../lib/entity-form";
import { entityHref } from "../lib/record-title";
import { styles } from "../lib/styles";
import { useFocusedData } from "../lib/useFocusedData";

const TEXT = {
  person: {
    title: "Add person",
    switchLink: "Adding a pet instead?",
    switchConfirm: "Switch to a pet?",
  },
  pet: {
    title: "Add pet",
    switchLink: "Adding a person instead?",
    switchConfirm: "Switch to a person?",
  },
  nameFirst: "Add a name to add birthdays, contacts and more.",
  switchConfirmBody:
    "The name and gender come with you. Everything added below them will be cleared.",
  switchConfirmAction: "Switch",
  cancel: "Cancel",
  saveFailed: "Couldn't save",
} as const;

const OTHER_TYPE: Record<EntityType, EntityType> = {
  person: "pet",
  pet: "person",
};

/** How long typing pauses before the draft takes the new details. */
const DRAFT_DELAY_MS = 400;

/**
 * Add a person, or a pet with `?type=pet`. Once named it is a draft, gathering
 * facts through the same screens a saved record uses, until Save publishes it.
 */
export default function AddScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [form, setForm] = useState(() => {
    const type: EntityType = params.type === "pet" ? "pet" : "person";
    return { type, initial: emptyEntityForm() };
  });

  // Keyed on the type, so a switch starts a fresh form, and discards the draft.
  return (
    <AddEntityForm
      key={form.type}
      type={form.type}
      initial={form.initial}
      onSwitch={(value) =>
        setForm({
          type: OTHER_TYPE[form.type],
          initial: switchedEntityForm(form.type, value),
        })
      }
    />
  );
}

function AddEntityForm({
  type,
  initial,
  onSwitch,
}: {
  type: EntityType;
  initial: EntityFormValue;
  onSwitch: (value: EntityFormValue) => void;
}) {
  const core = useCore();
  const router = useRouter();

  const [value, setValue] = useState<EntityFormValue>(initial);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  // The draft's creation, shared by everything that needs its id, and whether
  // it was saved, so leaving does not discard it.
  const draft = useRef<{ creating: Promise<string> | null; saved: boolean }>({
    creating: null,
    saved: false,
  });

  const details = entityDetailsOf(type, value);
  const problem = entityFormProblem(type, value);

  const ensureDraft = useCallback(
    (fields: CreatePersonInput | CreatePetInput): Promise<string> => {
      draft.current.creating ??= (
        type === "person"
          ? core.people.create(
              { ...(fields as CreatePersonInput), standing: "draft" },
              [],
            )
          : core.pets.create(
              { ...(fields as CreatePetInput), standing: "draft" },
              [],
            )
      ).then((record) => {
        setDraftId(record.id);
        return record.id;
      });
      return draft.current.creating;
    },
    [core, type],
  );

  // A moment after typing stops, the draft takes the details as typed.
  const detailsKey = JSON.stringify(details);
  useEffect(() => {
    if (details === null) return;
    const timer = setTimeout(() => {
      if (draft.current.saved) return;
      const creating = draft.current.creating;
      if (creating === null) {
        ensureDraft(details).catch((cause) => console.error(cause));
      } else {
        creating
          .then((id) => core.drafts.edit(type, id, details))
          .catch((cause) => console.error(cause));
      }
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
    // `detailsKey` stands for `details`, which is a new object every render.
  }, [detailsKey, ensureDraft, core, type]);

  // Leaving without saving takes the draft, and all it gathered, with it.
  useEffect(
    () => () => {
      if (draft.current.saved) return;
      void draft.current.creating
        ?.then((id) => core.drafts.discard(type, id))
        .catch((cause) => console.error(cause));
    },
    [core, type],
  );

  const load = useCallback(async () => {
    if (draftId === null) return null;
    const [view, holidays, gifts] = await Promise.all([
      type === "person" ? core.views.person(draftId) : core.views.pet(draftId),
      core.holidays.listForBearer(type, draftId),
      core.gifts.recipients.listForRecipient(type, draftId),
    ]);
    return view === null ? null : { view, holidays, gifts };
  }, [core, type, draftId]);
  const { data, reload } = useFocusedData(load);

  async function save() {
    if (details === null || saving) return;
    setSaving(true);
    try {
      const id = await ensureDraft(details);
      draft.current.saved = true;
      await core.drafts.publish(type, id, details);
      const record =
        type === "person" ? await core.people.get(id) : await core.pets.get(id);
      if (record === undefined) throw new Error("The record went missing.");
      // Replaced either way, so Back never returns to a filled-in form.
      const matches =
        type === "person"
          ? await core.duplicates.findFor(id).catch(() => [])
          : [];
      router.replace(
        matches.length > 0 ? `/duplicates?for=${id}` : entityHref(type, record),
      );
    } catch (e) {
      draft.current.saved = false;
      Alert.alert(TEXT.saveFailed, String(e));
      setSaving(false);
    }
  }

  // Both stable across a keystroke, so typing never reaches the navigator.
  const headerRight = useHeaderSave({
    problem,
    saving,
    onPress: () => void save(),
  });

  // Whether the draft has gathered anything a switch would throw away.
  const gathered =
    data !== null &&
    (data.view.tags.length > 0 ||
      data.view.timeline.length > 0 ||
      data.view.relationships.length > 0 ||
      ("contactMethods" in data.view && data.view.contactMethods.length > 0) ||
      data.holidays.some((h) => h.observes) ||
      data.gifts.length > 0);

  function switchType() {
    if (!gathered) {
      onSwitch(value);
      return;
    }
    Alert.alert(TEXT[type].switchConfirm, TEXT.switchConfirmBody, [
      { text: TEXT.cancel, style: "cancel" },
      {
        text: TEXT.switchConfirmAction,
        style: "destructive",
        onPress: () => onSwitch(value),
      },
    ]);
  }

  const title = TEXT[type].title;
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <FormScrollView contentContainerStyle={styles.screen}>
        <Pressable
          accessibilityRole="button"
          testID="add-switch-type"
          onPress={switchType}
          style={local.switchLink}
        >
          <Text style={styles.link}>{TEXT[type].switchLink}</Text>
        </Pressable>

        {type === "person" ? (
          <PersonFields
            draft={value.person}
            onChange={(person) => setValue((v) => ({ ...v, person }))}
          />
        ) : (
          <PetFields
            draft={value.pet}
            onChange={(pet) => setValue((v) => ({ ...v, pet }))}
          />
        )}

        {details === null && <Text style={styles.muted}>{TEXT.nameFirst}</Text>}
        {details !== null && data !== null && draftId !== null && (
          <RecordFacts
            type={type}
            id={draftId}
            subjectName={entityLabel(
              type,
              "person" in data.view ? data.view.person : data.view.pet,
            )}
            view={data.view}
            holidays={data.holidays}
            gifts={data.gifts}
            onChanged={() => void reload()}
          />
        )}
      </FormScrollView>
    </>
  );
}

const local = StyleSheet.create({
  // A full-height tap target for a one-line link.
  switchLink: { minHeight: 44, justifyContent: "center" },
});
