import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type EntityType, joinNameParts } from "@leapsake/schema";
import { FormScrollView } from "../components/FormScrollView";
import { useHeaderSave } from "../components/HeaderSave";
import { PersonFields } from "../components/PersonFields";
import { PetFields } from "../components/PetFields";
import { type RecordFactsView, RecordFacts } from "../components/RecordFacts";
import { BeforeSectionOpen } from "../components/SectionLink";
import { useCore } from "../lib/core-context";
import {
  type EntityFormValue,
  emptyEntityForm,
  entityDetailsOf,
  entityDraftDetailsOf,
  entityFormProblem,
  switchedEntityForm,
} from "../lib/entity-form";
import { entityHref } from "../lib/record-title";
import { styles } from "../lib/styles";
import { useFocusedData } from "../lib/useFocusedData";
import { Tappable } from "../components/Tappable";

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

/** The sections' contents before the first ➕ creates the draft. */
const NOTHING_GATHERED: RecordFactsView = {
  tags: [],
  timeline: [],
  relationships: [],
  contactMethods: [],
};

/** The name as typed so far, which may still be blank. */
function subjectNameOf(type: EntityType, value: EntityFormValue): string {
  if (type === "pet") return value.pet.name.trim();
  const { firstName, middleName, lastName } = value.person;
  return joinNameParts(firstName.trim(), middleName.trim(), lastName.trim());
}

/**
 * Add a person, or a pet with `?type=pet`. The first ➕ makes it a draft, which
 * gathers facts through the same screens a saved record uses until Save.
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
  // Picked up front, so the sections link to the draft before it exists.
  const [draftId] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState(false);
  // The draft's creation, shared by everything that needs it, and whether it
  // was saved, so leaving does not discard it.
  const draft = useRef<{ creating: Promise<void> | null; saved: boolean }>({
    creating: null,
    saved: false,
  });

  const details = entityDetailsOf(type, value);
  const problem = entityFormProblem(type, value);
  const typed = entityDraftDetailsOf(type, value);
  const latest = useRef(typed);
  latest.current = typed;

  // The first ➕ creates the draft, with whatever details are typed by then.
  const ensureDraft = useCallback((): Promise<void> => {
    draft.current.creating ??= core.drafts
      .create(type, draftId, latest.current)
      .then(
        () => setCreated(true),
        (cause: unknown) => {
          draft.current.creating = null;
          throw cause;
        },
      );
    return draft.current.creating;
  }, [core, type, draftId]);

  // A moment after typing stops, a draft takes the details as typed.
  const typedKey = JSON.stringify(typed);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft.current.saved) return;
      void draft.current.creating
        ?.then(() => core.drafts.edit(type, draftId, latest.current))
        .catch((cause) => console.error(cause));
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typedKey, core, type, draftId]);

  // Leaving without saving takes the draft, and all it gathered, with it.
  useEffect(
    () => () => {
      if (draft.current.saved) return;
      void draft.current.creating
        ?.then(() => core.drafts.discard(type, draftId))
        .catch((cause) => console.error(cause));
    },
    [core, type, draftId],
  );

  const load = useCallback(async () => {
    const [view, holidays, gifts] = await Promise.all([
      !created
        ? null
        : type === "person"
          ? core.views.person(draftId)
          : core.views.pet(draftId),
      core.holidays.listForBearer(type, draftId),
      created ? core.gifts.recipients.listForRecipient(type, draftId) : [],
    ]);
    const facts: RecordFactsView = view ?? NOTHING_GATHERED;
    return { view: facts, holidays, gifts };
  }, [core, type, draftId, created]);
  const { data, reload } = useFocusedData(load);

  async function save() {
    if (details === null || saving) return;
    setSaving(true);
    try {
      await ensureDraft();
      draft.current.saved = true;
      await core.drafts.publish(type, draftId, details);
      const record =
        type === "person"
          ? await core.people.get(draftId)
          : await core.pets.get(draftId);
      if (record === undefined) throw new Error("The record went missing.");
      // Replaced either way, so Back never returns to a filled-in form.
      const matches =
        type === "person"
          ? await core.duplicates.findFor(draftId).catch(() => [])
          : [];
      router.replace(
        matches.length > 0
          ? `/duplicates?for=${draftId}`
          : entityHref(type, record),
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
      (data.view.contactMethods ?? []).length > 0 ||
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
        <Tappable
          accessibilityRole="button"
          testID="add-switch-type"
          onPress={switchType}
          style={local.switchLink}
        >
          <Text style={styles.link}>{TEXT[type].switchLink}</Text>
        </Tappable>

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

        {data !== null && (
          <BeforeSectionOpen.Provider value={ensureDraft}>
            <RecordFacts
              type={type}
              id={draftId}
              subjectName={subjectNameOf(type, value)}
              view={data.view}
              holidays={data.holidays}
              gifts={data.gifts}
              onChanged={() => void reload()}
            />
          </BeforeSectionOpen.Provider>
        )}
      </FormScrollView>
    </>
  );
}

const local = StyleSheet.create({
  // A full-height tap target for a one-line link.
  switchLink: { minHeight: 44, justifyContent: "center" },
});
