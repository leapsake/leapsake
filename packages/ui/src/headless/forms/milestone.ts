import {
  type Milestone,
  type MilestoneBearerType,
  type MilestoneKind,
  type ReminderRuleInput,
  milestoneDraftOf,
  milestoneDraftWithKind,
  milestoneDraftWithSchedule,
  milestoneInputOf,
} from "@leapsake/schema";
import { useDraftForm } from "./use-draft-form.js";

/** The milestone form's state, from the milestone being edited or blanks. */
export function useMilestoneForm(start: {
  bearerType: MilestoneBearerType;
  milestone?: Pick<Milestone, "kind" | "year" | "month" | "day" | "note"> &
    Partial<Pick<Milestone, "asksEachYear">>;
  kind?: MilestoneKind;
  reminderSchedule?: ReminderRuleInput[];
}) {
  const form = useDraftForm(() => milestoneDraftOf(start), milestoneInputOf);
  const { update } = form;
  return {
    ...form,
    setKind: (kind: MilestoneKind) =>
      update((draft) => milestoneDraftWithKind(draft, kind)),
    setSchedule: (rules: ReminderRuleInput[]) =>
      update((draft) => milestoneDraftWithSchedule(draft, rules)),
  };
}
