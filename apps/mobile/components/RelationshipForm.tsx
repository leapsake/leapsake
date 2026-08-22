import { useMemo, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Stack } from "expo-router";
import type { RelationshipCandidate } from "@leapsake/core";
import type { EntityType } from "@leapsake/schema";
import { useHeaderSave } from "./HeaderSave";
import {
  type RelationshipDraft,
  type RelationshipFormValue,
  RelationshipFields,
  relationshipDraftToValue,
  relationshipDraftValid,
} from "./RelationshipFields";
import { styles } from "../lib/styles";

/**
 * One relationship on a screen of its own — the add and edit routes a person's
 * or a pet's page pushes to. It is {@link RelationshipFields} plus the two
 * things a screen owes: the native header (title and a right-aligned
 * {@link HeaderSave}) and the scroll view. There is no Cancel — "‹ Back"
 * already leaves. The shape is {@link MilestoneForm}'s, deliberately.
 *
 * It is not the `RelationshipForm` that used to exist. That one held a value
 * model of its own — a locked other end, an initial role, an initial note — and
 * assembled a draft from three props. This owns nothing but the draft it is
 * seeded with: the route builds that, because only the route knows whether it is
 * adding, materialising an inference, or revising a stored edge, and the draft
 * is the same shape in all three.
 *
 * The four routes share it rather than mirroring it, and what differs between
 * them is `onSubmit` — which is the whole of the difference. `canChangeOther`
 * is false wherever the write behind the screen doesn't allow one:
 * `editFromSubject` changes a role and never an endpoint, and materialising a
 * derived neighbour is only true of the pair inference already found.
 */
export function RelationshipForm({
  title,
  subjectType,
  candidates,
  initialDraft,
  canChangeOther = true,
  onSubmit,
}: {
  /** The native header title, set here so it's declared in one place. */
  title: string;
  subjectType: EntityType;
  /** Who the other end may be — empty where it is already settled. */
  candidates?: readonly RelationshipCandidate[];
  /** What the screen opens on, built by the route. */
  initialDraft: RelationshipDraft;
  canChangeOther?: boolean;
  onSubmit: (value: RelationshipFormValue) => Promise<void>;
}) {
  // Seeded once, like every other form here: the route's loader re-runs on
  // focus and on a background pull, and reseeding would discard the edit.
  const [draft, setDraft] = useState(() => initialDraft);
  const [submitting, setSubmitting] = useState(false);

  const canSave = !submitting && relationshipDraftValid(draft);

  async function save() {
    const value = relationshipDraftToValue(draft);
    if (!canSave || value === null) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
    } catch (e) {
      Alert.alert("Couldn't save", String(e));
      setSubmitting(false);
    }
  }

  const headerRight = useHeaderSave({
    canSave,
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
        <RelationshipFields
          subjectType={subjectType}
          candidates={candidates}
          canChangeOther={canChangeOther}
          draft={draft}
          onChange={setDraft}
        />
      </ScrollView>
    </>
  );
}
