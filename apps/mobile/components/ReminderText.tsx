import { type StyleProp, Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { type Tag, normalizeTagName, splitHashtags } from "@leapsake/schema";
import { styles } from "../lib/styles";

/**
 * Render reminder text with its inline `#tags` as tappable links to their tag
 * pages, as one <Text> (so it flows and wraps like prose). The reminder's
 * resolved {@link Tag}s supply the ids, keyed by normalized name; a `#token` with
 * no matching stored tag — which shouldn't happen, since a reminder's tags are
 * derived from this text — renders as plain text.
 *
 * `onPressText` makes the non-tag runs tappable too (the list uses it to open the
 * reminder while its tags still navigate to their own pages); omit it on screens
 * where the surrounding text isn't itself a link. Segment order is stable, so the
 * array index is a safe key.
 */
export function ReminderText({
  text,
  tags,
  style,
  onPressText,
}: {
  text: string;
  tags: Tag[];
  style?: StyleProp<TextStyle>;
  onPressText?: () => void;
}) {
  const router = useRouter();
  const idByName = new Map(tags.map((tag) => [tag.normalized, tag.id]));

  return (
    <Text style={style} onPress={onPressText}>
      {splitHashtags(text).map((segment, i) => {
        const id =
          segment.tagName !== null
            ? idByName.get(normalizeTagName(segment.tagName))
            : undefined;
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
      })}
    </Text>
  );
}
