import { type StyleProp, Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import {
  type ResolvedMention,
  type Tag,
  normalizeTagName,
  splitAnnotatedText,
} from "@leapsake/schema";
import { styles } from "../lib/styles";

/**
 * Render reminder text with its inline `#tags` (linked to their tag pages) and
 * `@mentions` (linked to the person/pet they name) as tappable links, all as one
 * <Text> so it flows and wraps like prose. Tag ids come from the resolved {@link
 * Tag}s (keyed by normalized name); a mention's label comes from the resolved
 * {@link ResolvedMention}s (keyed by `type:id`) — the **current** label, so a
 * rename shows through, falling back to the token's snapshot name (and no link)
 * when the target is gone. RN can't nest a <Link> inside <Text>, so links are
 * nested <Text> with `onPress` → `router.push`.
 *
 * `onPressText` makes the non-link runs tappable too (the list uses it to open the
 * reminder while its tags/mentions still navigate to their own pages); omit it on
 * screens where the surrounding text isn't itself a link. Segment order is stable,
 * so the array index is a safe key.
 */
export function ReminderText({
  text,
  tags,
  mentions,
  style,
  onPressText,
}: {
  text: string;
  tags: Tag[];
  mentions: ResolvedMention[];
  style?: StyleProp<TextStyle>;
  onPressText?: () => void;
}) {
  const router = useRouter();
  const tagIdByName = new Map(tags.map((tag) => [tag.normalized, tag.id]));
  const labelByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m.label]),
  );

  return (
    <Text style={style} onPress={onPressText}>
      {splitAnnotatedText(text).map((segment, i) => {
        if (segment.kind === "hashtag") {
          const id = tagIdByName.get(normalizeTagName(segment.tagName));
          if (id === undefined) return <Text key={i}>{segment.text}</Text>;
          return (
            <Text
              key={i}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => router.push(`/tags/${id}`)}
            >
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === "mention") {
          const label = labelByTarget.get(
            `${segment.targetType}:${segment.targetId}`,
          );
          if (typeof label !== "string") {
            return <Text key={i}>{segment.displayName}</Text>;
          }
          const href =
            segment.targetType === "person"
              ? `/people/${segment.targetId}`
              : `/pets/${segment.targetId}`;
          return (
            <Text
              key={i}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => router.push(href)}
            >
              {label}
            </Text>
          );
        }
        return <Text key={i}>{segment.text}</Text>;
      })}
    </Text>
  );
}
