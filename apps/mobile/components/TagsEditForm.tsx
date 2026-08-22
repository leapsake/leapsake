import { useMemo, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { type EntityType, type Tag, parseTagNames } from "@leapsake/schema";
import { useHeaderSave } from "./HeaderSave";
import { TagsInput, tagsRawOf } from "./TagsInput";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The native header title, declared here so both routes agree on it. */
export const TAGS_EDIT_TITLE = "Edit tags";

/**
 * A record's tags on a screen of their own — behind the **Edit** on the Tags row
 * of a person's or a pet's page, and the only screen either has for the one
 * field their details form deliberately doesn't hold.
 *
 * It is {@link TagsInput} plus what a screen owes it: the header (title and a
 * right-aligned {@link HeaderSave}) and the scroll view. There is no Cancel —
 * "‹ Back" already leaves. See {@link MilestoneForm}, the same shape.
 *
 * **Shared between people and pets rather than mirrored.** The two `update`
 * calls take the same third argument and differ only in which table they touch,
 * and unlike a name there is nothing type-shaped about a tag. The record's own
 * fields go the other way for the same reason: those really are two different
 * questions.
 *
 * An empty `Update*Input` alongside the tags is a legitimate write, and one
 * `packages/core` already makes — it is how a merge bumps the survivor's clock.
 * So tags can be saved without naming a single other field.
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
  // Seeded **once**, from the tags as they stood when the screen opened: the
  // route's loader re-runs on focus and whenever a background pull lands, and a
  // field reseeded mid-edit would throw away what the user had typed.
  const [raw, setRaw] = useState(() => tagsRawOf(tags));
  const [saving, setSaving] = useState(false);

  // Always saveable: clearing every tag is a change like any other, and there is
  // no state a tag string can be in that the parser would refuse.
  const canSave = !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const names = parseTagNames(raw);
      await (type === "person"
        ? core.people.update(id, {}, names)
        : core.pets.update(id, {}, names));
      // Back to the record, which refetches on focus and so reads as this left it.
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    canSave,
    saving,
    onPress: () => void save(),
  });
  const options = useMemo(
    () => ({ title: TAGS_EDIT_TITLE, headerRight }),
    [headerRight],
  );

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
