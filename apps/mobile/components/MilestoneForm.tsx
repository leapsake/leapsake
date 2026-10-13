import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import {
  type Milestone,
  type MilestoneBearerType,
  type MilestoneDraftResult,
  type MilestoneKind,
  type OfferContext,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { useMilestoneForm } from "@leapsake/ui/headless";
import { useHeaderSave } from "./HeaderSave";
import { MilestoneFields, milestoneProblem } from "./MilestoneFields";
import { useCore } from "../lib/core-context";

type MilestoneSubmit = Extract<MilestoneDraftResult, { ok: true }>;

/** A milestone on a screen of its own, Save in the header; the screen owns
 *  the core call. */
export function MilestoneForm({
  title,
  bearerType,
  bearerId,
  milestone,
  initialKind,
  onSubmit,
}: {
  /** The native header title, set here so it's declared in one place. */
  title?: string;
  bearerType: MilestoneBearerType;
  bearerId: string;
  milestone?: Milestone;
  /** The kind to open on when creating, where the caller knows which is
   *  wanted. */
  initialKind?: MilestoneKind;
  onSubmit: (input: MilestoneSubmit["input"]) => Promise<void>;
}) {
  const core = useCore();
  const form = useMilestoneForm({ bearerType, milestone, kind: initialKind });
  const [submitting, setSubmitting] = useState(false);
  const headerRight = useHeaderSave({
    problem: milestoneProblem(form.errors),
    saving: submitting,
    onPress: () => void handleSubmit(),
  });

  const { update } = form;
  const savedId = milestone?.id;
  const savedKind = milestone?.kind;
  // Loads the saved milestone's stored schedule over the kind's defaults,
  // unless the user has already edited the schedule.
  useEffect(() => {
    if (savedId === undefined || savedKind === undefined) return;
    let active = true;
    void core.milestones.reminderSchedule(savedId, savedKind).then((loaded) => {
      if (!active) return;
      update((draft) =>
        draft.scheduleCustomized
          ? draft
          : { ...draft, reminderSchedule: loaded },
      );
    });
    return () => {
      active = false;
    };
  }, [core, savedId, savedKind, update]);

  // Whose occasion this kind would be, which words the schedule and, on a kind
  // the milestone was not saved as, seeds its own or memorial list.
  const kind = form.fields.kind;
  const [offer, setOffer] = useState<{
    kind: MilestoneKind;
    context: OfferContext;
  }>();
  useEffect(() => {
    let active = true;
    void core.milestones
      .scheduleContext(bearerType, bearerId, kind)
      .then(({ audience, reachable, offer: context }) => {
        if (!active) return;
        setOffer({ kind, context });
        if (audience === "theirs" || kind === savedKind) return;
        update((draft) =>
          draft.scheduleCustomized || draft.kind !== kind
            ? draft
            : {
                ...draft,
                reminderSchedule: resolveReminderSchedule(
                  kind,
                  [],
                  audience,
                  reachable,
                ).rules,
              },
        );
      });
    return () => {
      active = false;
    };
  }, [core, bearerType, bearerId, kind, savedKind, update]);

  async function handleSubmit() {
    const shaped = form.submit();
    if (shaped === null || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(shaped.input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title, headerRight }} />
      <MilestoneFields
        scroll
        draft={form.fields}
        onChange={(draft) => update(() => draft)}
        errors={form.errors}
        bearerType={bearerType}
        offer={offer?.kind === kind ? offer.context : undefined}
        kindFixed={milestone === undefined && initialKind !== undefined}
      />
    </>
  );
}
