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
 * Render reminder text with its inline `#tags` and `@mentions` highlighted, all as
 * one <Text> so it flows and wraps like prose. Tag ids come from the resolved
 * {@link Tag}s (keyed by normalized name); a mention's label comes from the
 * resolved {@link ResolvedMention}s (keyed by `type:id`) — the **current** label,
 * so a rename shows through, falling back to the token's snapshot name when the
 * target is gone. Both keep their sigil, so a mention reads as `@Violet Bick` here
 * exactly as it did in the composer that wrote it. RN can't nest a <Link> inside
 * <Text>, so links are nested <Text> with `onPress` → `router.push`.
 *
 * `linkAnnotations` decides whether those highlights are *tappable*, and the two
 * screens want opposite answers. On a **detail** screen (the default) a tag or
 * mention is its own link out to the tag page or the person it names. In the
 * **list** it is not: a row is one destination — the reminder — and a phone gives
 * a `#tag` inside a sentence a target a few millimetres wide, sat inside the very
 * region the user is trying to hit. Highlighting without linking keeps the
 * annotation legible as an annotation while letting the whole row take the tap.
 *
 * An **unresolved** annotation is plain text in either mode: the highlight means
 * "this points at something that exists", so a tag with no page and a mention
 * whose target is gone shouldn't wear it. Segment order is stable, so the array
 * index is a safe key.
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
  /** Whether tags and mentions navigate to their own pages. Off in a list, whose
   *  rows are themselves one big link — see above. */
  linkAnnotations?: boolean;
}) {
  const router = useRouter();
  // Both maps hold the resolved record rather than a field of it, because a link
  // out of this sentence carries the name its destination will show and only the
  // resolved record knows that name: the `#Birthday` a user typed here may be
  // stored as `#birthday`, and a mention's label follows the target's renames.
  const tagByName = new Map(tags.map((tag) => [tag.normalized, tag]));
  const mentionByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m]),
  );

  /** One run of the sentence. `href` is where it points, or `null` for ordinary
   *  prose and for an annotation whose target is gone — the two conditions stay
   *  separate on purpose, since highlighted-but-not-tappable is a real state. */
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
          // The sigil is this sentence's punctuation rather than part of the
          // name, so the link carries the bare label and the page is titled with
          // it — `@Violet Bick` here, "Violet Bick" over there.
          return run(i, `@${mention.label}`, mentionHref(mention));
        }
        return run(i, segment.text, null);
      })}
    </Text>
  );
}
