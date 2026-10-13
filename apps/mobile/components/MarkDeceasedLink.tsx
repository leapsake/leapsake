import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import type { MilestoneTimelineEntry } from "@leapsake/schema";
import { styles } from "../lib/styles";

const TEXT = { markDeceased: "Mark as passed away…" } as const;

/** Opens a Death milestone for a person or pet, until they have one. */
export function MarkDeceasedLink({
  bearerType,
  bearerId,
  timeline,
}: {
  bearerType: "person" | "pet";
  bearerId: string;
  timeline: readonly MilestoneTimelineEntry[];
}) {
  const router = useRouter();
  const deceased = timeline.some(
    (entry) => entry.origin === "own" && entry.milestone.kind === "death",
  );
  if (deceased) return null;
  const base = bearerType === "pet" ? "/pets" : "/people";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push(`${base}/${bearerId}/milestones/new?kind=death`)
      }
    >
      <Text style={styles.link}>{TEXT.markDeceased}</Text>
    </Pressable>
  );
}
