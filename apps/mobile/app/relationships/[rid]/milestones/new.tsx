import { type MilestoneKind, isMilestoneKind } from "@leapsake/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MilestoneForm } from "../../../../components/MilestoneForm";
import { useCore } from "../../../../lib/core-context";

export default function RelationshipMilestoneNewScreen() {
  const core = useCore();
  const router = useRouter();
  const { rid, kind } = useLocalSearchParams<{ rid: string; kind?: string }>();
  // `?kind=`, from the partnership question's CTA, opens on that kind.
  // Validated rather than cast: it arrives from a navigation parameter.
  const initialKind: MilestoneKind | undefined = isMilestoneKind(kind)
    ? kind
    : undefined;

  // Nothing loads first, so the form declares the header from the start.
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
