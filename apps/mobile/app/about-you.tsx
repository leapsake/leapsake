import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { Typeahead } from "../components/Typeahead";
import {
  type PersonDraft,
  PersonFields,
  emptyPersonDraft,
  personDraftToInput,
  personDraftValid,
} from "../components/PersonFields";
import { useCore } from "../lib/core-context";
import { entityHref } from "../lib/record-title";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/**
 * Every user-visible string on this screen, in one place so the later
 * message-catalog sweep is mechanical (AGENTS.md → *User-visible text*).
 */
const TEXT = {
  title: "Tell us about yourself",
  /** Why it is worth answering, said once and without a guilt trip. */
  lede: "Leapsake keeps track of who is who around you, so it helps to know where you are in that. Gifts and family connections both start from you.",
  pick: "Which of these is you?",
  /** Over the form when there is a list above it, and over it when there isn't. */
  addWithList: "Or add yourself",
  addAlone: "Add yourself",
  /** Offered only to a store with nobody in it: the fastest way to get a list to
   *  pick from, rather than typing a name in to answer one question. */
  importFirst: "Import from your contacts",
  save: "Save",
  saving: "Saving…",
  failed: "Couldn’t save",
} as const;

/**
 * **Tell us about yourself** — where the `about-you` onboarding nudge lands, and
 * the only screen that sets the self-person.
 *
 * It replaced the People list's `?pick=self` mode, which could only ask *which of
 * these is you?* and therefore could only be asked once the user had already put
 * someone in the app. That made the step wait on an unrelated action and stacked
 * it onto the moment the first person landed. This screen answers the question
 * from either end, so the nudge stands from day one:
 *
 * - **With people in the store**, a typeahead over them. Better than a list to
 *   scroll at the moment it matters most — straight after importing an address
 *   book, when there are hundreds of rows and you know your own name.
 * - **With none**, the offer to import, because a store with nobody in it wants
 *   an address book more than it wants one hand-typed name.
 * - **Either way, the form**, so "I'm not in there" is always answerable without
 *   leaving.
 *
 * The form is {@link PersonFields} — the name and gender a person is created
 * with — and deliberately *not* the create screen's full staging of milestones,
 * contacts and relationships. This screen asks one question. Landing on your own
 * page afterwards is what puts the rest within reach, your birthday included.
 */
export default function AboutYouScreen() {
  const core = useCore();
  const router = useRouter();
  const load = useCallback(() => core.views.entityList(), [core]);
  const { data: entities, error } = useFocusedData(load);
  const [draft, setDraft] = useState<PersonDraft>(emptyPersonDraft);
  const [saving, setSaving] = useState(false);

  /** Set an existing person as you, then drop back to Home — the answer is
   *  recorded and there is nothing further to do here. Home is in the tab
   *  navigator underneath, so this dismisses to it rather than stacking a second
   *  copy of the tabs (the same move `import.tsx` makes on the way out). */
  function pick(person: EntityRow) {
    core.self.set(person.id).then(
      () => router.dismissTo("/"),
      (cause: unknown) => Alert.alert(TEXT.failed, String(cause)),
    );
  }

  /**
   * Write yourself in, then become the self-person in the same breath.
   *
   * It lands on the new person's page rather than back on Home, which is the one
   * place the two answers differ: picking an existing person tells the app
   * something it can act on immediately, while a person created here is a name
   * and nothing else. Their page is where the birthday goes, and it is already
   * open.
   */
  async function save() {
    if (!personDraftValid(draft) || saving) return;
    setSaving(true);
    try {
      const created = await core.people.create(personDraftToInput(draft), []);
      await core.self.set(created.id);
      router.replace(entityHref("person", created));
    } catch (cause) {
      Alert.alert(TEXT.failed, String(cause));
      setSaving(false);
    }
  }

  if (error !== null) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: TEXT.title }} />
        <Text style={styles.danger}>{error}</Text>
      </ScrollView>
    );
  }
  if (entities === null) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: TEXT.title }} />
        <ActivityIndicator />
      </ScrollView>
    );
  }

  // Only a person can be you, so a store of nothing but pets counts as empty
  // here — and is offered the importer, exactly like a store of nothing at all.
  const people = entities.filter((entity) => entity.type === "person");

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: TEXT.title }} />
      <Text style={styles.rowText}>{TEXT.lede}</Text>

      {people.length > 0 ? (
        <Typeahead
          label={TEXT.pick}
          value={null}
          options={people}
          onChange={(person) => {
            if (person !== null) pick(person);
          }}
          getKey={(person) => person.id}
          getLabel={(person) => person.label}
          testID="about-you-pick"
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => router.push("/import")}
        >
          <Text style={styles.buttonText}>{TEXT.importFirst}</Text>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>
        {people.length > 0 ? TEXT.addWithList : TEXT.addAlone}
      </Text>
      <PersonFields draft={draft} onChange={setDraft} />
      <Pressable
        accessibilityRole="button"
        disabled={!personDraftValid(draft) || saving}
        style={styles.button}
        onPress={() => void save()}
      >
        <Text style={styles.buttonText}>
          {saving ? TEXT.saving : TEXT.save}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
