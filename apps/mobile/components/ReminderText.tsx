import { type StyleProp, Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import {
  type ResolvedMention,
  type Tag,
  normalizeTagName,
  splitAnnotatedText,
  tagLabel,
} from "@leapsake/schema";
import { withTitle } from "../lib/record-title";
import { styles } from "../lib/styles";

/**
 * Render reminder text with its inline `#tags` and `@mentions` highlighted, all as
 * one <Text> so it flows and wraps like prose. Tag ids come from the resolved
 * {@link Tag}s (keyed by normalized name); a mention's label comes from the
 * resolved {@link ResolvedMention}s (keyed by `type:id`) — the **current** label,
 * so a rename shows through, falling back to the token's snapshot name when the
 * target is gone. Both keep their sigil, so a mention reads as `@Alice Ng` here
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
  // Keyed to the whole tag rather than just its id: a link out to a tag page
  // carries the label that page will show, and only the resolved tag knows how
  // it is actually spelled — the `#Birthday` a user typed here may be stored as
  // `#birthday`, and sending the typed one would title the page wrong for a beat.
  const tagByName = new Map(tags.map((tag) => [tag.normalized, tag]));
  const labelByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m.label]),
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
          return run(
            i,
            segment.text,
            tag === undefined
              ? null
              : withTitle(`/tags/${tag.id}`, tagLabel(tag.name)),
          );
        }
        if (segment.kind === "mention") {
          const label = labelByTarget.get(
            `${segment.targetType}:${segment.targetId}`,
          );
          if (typeof label !== "string")
            return run(i, `@${segment.displayName}`, null);
          // The sigil is this sentence's punctuation, not part of the name, so
          // the page is titled with the bare label the mention resolved to.
          return run(
            i,
            `@${label}`,
            withTitle(
              segment.targetType === "person"
                ? `/people/${segment.targetId}`
                : `/pets/${segment.targetId}`,
              label,
            ),
          );
        }
        return run(i, segment.text, null);
      })}
    </Text>
  );
}
