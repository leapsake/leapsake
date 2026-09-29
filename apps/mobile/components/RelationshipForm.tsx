import { type ComponentProps, useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { RelationshipCandidate } from "@leapsake/core";
import type {
  EntityType,
  RelationshipDraft,
  RelationshipDraftErrors,
  RelationshipDraftResult,
} from "@leapsake/schema";
import { useRelationshipForm } from "@leapsake/ui/headless";
import { useHeaderSave } from "./HeaderSave";
import { RelationshipFields } from "./RelationshipFields";

type RelationshipSubmit = Extract<RelationshipDraftResult, { ok: true }>;

const TEXT = {
  saveFailed: "Couldn’t save",
  roleRequired: "Pick a role before saving.",
  otherRequired: "Say who the relationship is with before saving.",
  otherNotHolder:
    "That role doesn’t fit who you picked. Choose another role or another name.",
  noteRequired: "Add a note saying what the relationship is before saving.",
} as const;

/**
 * One relationship on a screen of its own. The route builds the draft and
 * `onSubmit`, since only it knows whether it adds, materialises or revises.
 */
export function RelationshipForm({
  title,
  subjectType,
  candidates,
  initialDraft,
  canChangeOther = true,
  commitOther,
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
  commitOther?: ComponentProps<typeof RelationshipFields>["commitOther"];
  onSubmit: (input: RelationshipSubmit["input"]) => Promise<void>;
}) {
  const form = useRelationshipForm({
    subjectType,
    initial: initialDraft,
    otherFixed: !canChangeOther,
    candidates,
  });
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
    problem: relationshipProblem(form.errors),
    saving: submitting,
    onPress: () => void save(),
  });
  const options = useMemo(() => ({ title, headerRight }), [title, headerRight]);

  return (
    <>
      <Stack.Screen options={options} />
      <RelationshipFields
        scroll
        candidates={candidates}
        canChangeOther={canChangeOther}
        commitOther={commitOther}
        draft={form.fields}
        onChange={(draft) => form.update(() => draft)}
        setRole={form.setRole}
        roleOptions={form.roleOptions}
        otherTypes={form.otherTypes}
      />
    </>
  );
}

function relationshipProblem(
  errors: RelationshipDraftErrors,
): string | undefined {
  if (errors.role === "required") return TEXT.roleRequired;
  if (errors.other === "notHolder") return TEXT.otherNotHolder;
  if (errors.other !== undefined) return TEXT.otherRequired;
  if (errors.note === "required") return TEXT.noteRequired;
  return undefined;
}
