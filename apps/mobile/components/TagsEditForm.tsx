import { useMemo, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { type EntityType, type Tag, parseTagNames } from "@leapsake/schema";
import { useHeaderSave } from "./HeaderSave";
import { TagsInput, tagsRawOf } from "./TagsInput";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The title before the record has loaded. */
export const TAGS_TITLE = "Tags";

/** Matches the link that opened it: "Add tags" when there are none. */
const titleFor = (count: number) => (count === 0 ? "Add tags" : "Edit tags");

/**
 * A person's or pet's tags on a screen of their own. Saved with an empty
 * `Update*Input`, a legitimate write that names no other field.
 */
export function TagsEditForm({
  id,
  type,
  tags,
}: {
  id: string;
  type: EntityType;
  /** The record's stored tags, as read once by the route that mounts this. */
  tags: readonly Tag[];
}) {
  const core = useCore();
  const router = useRouter();
  // Seeded once, so a reload on focus cannot discard typing.
  const [raw, setRaw] = useState(() => tagsRawOf(tags));
  const [saving, setSaving] = useState(false);

  // Always saveable: no tag string is one the parser would refuse.
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const names = parseTagNames(raw);
      await (type === "person"
        ? core.people.update(id, {}, names)
        : core.pets.update(id, {}, names));
      // Back to the record, which refetches on focus.
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    saving,
    onPress: () => void save(),
  });
  // Fixed when the screen opens, not flipped by the first keystroke.
  const [title] = useState(() => titleFor(tags.length));
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <TagsInput label="Tags" value={raw} onChange={setRaw} />
      </ScrollView>
    </>
  );
}
