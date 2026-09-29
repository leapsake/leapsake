import { type StyleProp, Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import {
  type ResolvedMention,
  type Tag,
  normalizeTagName,
  splitAnnotatedText,
} from "@leapsake/schema";
import { mentionHref, tagHref } from "../lib/record-title";
import { styles } from "../lib/styles";

/**
 * Reminder text as one wrapping `<Text>`, resolved `#tags` and `@mentions`
 * highlighted; RN nests no `<Link>` in text, so links are pressable runs.
 */
export function ReminderText({
  text,
  tags,
  mentions,
  style,
  linkAnnotations = true,
}: {
  text: string;
  tags: Tag[];
  mentions: ResolvedMention[];
  style?: StyleProp<TextStyle>;
  /** Whether tags and mentions navigate; off in a list, whose rows are
   *  links. */
  linkAnnotations?: boolean;
}) {
  const router = useRouter();
  // Whole records, since a link carries the name its page shows: a typed
  // `#Birthday` may be stored `#birthday`, and a mention follows renames.
  const tagByName = new Map(tags.map((tag) => [tag.normalized, tag]));
  const mentionByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m]),
  );

  /** One run; `href` is `null` for prose and for a gone target alike. */
  function run(key: number, content: string, href: string | null) {
    if (href === null) return <Text key={key}>{content}</Text>;
    if (!linkAnnotations)
      return (
        <Text key={key} style={styles.link}>
          {content}
        </Text>
      );
    return (
      <Text
        key={key}
        style={styles.link}
        accessibilityRole="link"
        onPress={() => router.push(href)}
      >
        {content}
      </Text>
    );
  }

  return (
    <Text style={style}>
      {splitAnnotatedText(text).map((segment, i) => {
        if (segment.kind === "hashtag") {
          const tag = tagByName.get(normalizeTagName(segment.tagName));
          return run(i, segment.text, tag === undefined ? null : tagHref(tag));
        }
        if (segment.kind === "mention") {
          const mention = mentionByTarget.get(
            `${segment.targetType}:${segment.targetId}`,
          );
          if (mention === undefined || typeof mention.label !== "string")
            return run(i, `@${segment.displayName}`, null);
          // The sigil is punctuation here; the link carries the bare label.
          return run(i, `@${mention.label}`, mentionHref(mention));
        }
        return run(i, segment.text, null);
      })}
    </Text>
  );
}
