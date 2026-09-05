import { type MilestoneKind, isMilestoneKind } from "@leapsake/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function RelationshipMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid, kind } = useLocalSearchParams<{ rid: string; kind?: string }>();
  // `?kind=` opens the form on a chosen kind — set by the partnership question's
  // CTA, which would otherwise hand its own question back as a blank picker.
  // Validated rather than cast: it arrives from a navigation parameter.
  const initialKind: MilestoneKind | undefined = isMilestoneKind(kind)
    ? kind
    : undefined;

  // The form declares the header (title + Save) itself; nothing loads first here,
  // so it is mounted from the start and this screen never needs its own.
  return (
    <MilestoneForm
      title="Add milestone"
      bearerType="relationship"
      initialKind={initialKind}
      onSubmit={async (value) => {
        await core.milestones.create({
          ...value,
          bearerType: "relationship",
          bearerId: rid,
        });
        router.back();
      }}
    />
  );
}
