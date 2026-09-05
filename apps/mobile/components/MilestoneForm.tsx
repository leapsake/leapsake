import { useEffect, useRef, useState } from "react";
import { ScrollView } from "react-native";
import { Stack } from "expo-router";
import {
  type Milestone,
  type MilestoneBearerType,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { HeaderSave } from "./HeaderSave";
import {
  type MilestoneFormValue,
  MilestoneFields,
  emptyMilestoneDraft,
  milestoneDraftFrom,
  milestoneDraftToValue,
  milestoneDraftValid,
} from "./MilestoneFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A milestone on a screen of its own — the add and edit routes a relationship's
 * page pushes to, which are the last places a milestone is authored anywhere but
 * on an entity form. It is {@link MilestoneFields} plus the two things a screen
 * owes: the native header (title and a right-aligned {@link HeaderSave}) and the
 * scroll view. There is no Cancel — "‹ Back" already leaves.
 *
 * The entity form stages milestones instead ({@link StagedMilestonesSection}),
 * where the fields are open and live and the form's own Save writes them. This is
 * the same fields with a Save of its own, because a relationship's milestones have
 * no such form to sit inside.
 *
 * Editing loads the milestone's stored reminder schedule, once, and only over a
 * schedule the user hasn't already touched — the draft opens on the kind's
 * defaults, which is the right answer if the load never lands.
 */
export function MilestoneForm({
  title,
  bearerType,
  milestone,
  onSubmit,
}: {
  /** The native header title, set here so it's declared in one place. */
  title?: string;
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  onSubmit: (value: MilestoneFormValue) => Promise<void>;
}) {
  const core = useCore();
  const [draft, setDraft] = useState(() =>
    milestone === undefined
      ? emptyMilestoneDraft(bearerType)
      : // Its kind's defaults until the stored rules land below — the right
        // answer if they never do.
        milestoneDraftFrom(
          milestone,
          resolveReminderSchedule(milestone.kind, []).rules,
        ),
  );
  const [submitting, setSubmitting] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (milestone === undefined || hydratedRef.current) return;
    hydratedRef.current = true;
    let active = true;
    void core.milestones
      .reminderSchedule(milestone.id, milestone.kind)
      .then((loaded) => {
        if (!active) return;
        setDraft((current) =>
          current.scheduleCustomized
            ? current
            : { ...current, reminderSchedule: loaded },
        );
      });
    return () => {
      active = false;
    };
  }, [core, milestone]);

  const canSubmit = !submitting && milestoneDraftValid(draft);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(milestoneDraftToValue(draft));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={submitting}
              onPress={() => void handleSubmit()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <MilestoneFields
          draft={draft}
          onChange={setDraft}
          bearerType={bearerType}
        />
      </ScrollView>
    </>
  );
}
