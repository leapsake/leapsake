import { Fragment } from "react";
import {
  type ResolvedMention,
  type Tag,
  normalizeTagName,
  splitAnnotatedText,
} from "@leapsake/schema";
import { Link } from "react-router-dom";

/**
 * Render freeform reminder text with its inline `#tags` linked to their tag pages
 * and its `@mentions` linked to the person/pet they name. The reminder's resolved
 * {@link Tag}s supply tag ids (keyed by normalized name); its {@link
 * ResolvedMention}s supply each target's **current** label (keyed by
 * `type:id`) — a rename shows through. A mention whose target is gone (`label`
 * null) or unresolved falls back to the token's snapshot name as plain text; a
 * `#token`/mention with no match — which shouldn't happen, since both are derived
 * from this very text — likewise falls back to plain text. Segment order is
 * stable, so the array index is a safe key.
 */
export function ReminderText({
  text,
  tags,
  mentions,
}: {
  text: string;
  tags: Tag[];
  mentions: ResolvedMention[];
}) {
  const tagIdByName = new Map(tags.map((tag) => [tag.normalized, tag.id]));
  const labelByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m.label]),
  );
  return (
    <>
      {splitAnnotatedText(text).map((segment, i) => {
        if (segment.kind === "hashtag") {
          const id = tagIdByName.get(normalizeTagName(segment.tagName));
          return id !== undefined ? (
            <Link key={i} to={`/tags/${id}`}>
              {segment.text}
            </Link>
          ) : (
            <Fragment key={i}>{segment.text}</Fragment>
          );
        }
        if (segment.kind === "mention") {
          const label = labelByTarget.get(
            `${segment.targetType}:${segment.targetId}`,
          );
          if (typeof label === "string") {
            const to =
              segment.targetType === "person"
                ? `/people/${segment.targetId}`
                : `/pets/${segment.targetId}`;
            return (
              <Link key={i} to={to}>
                {label}
              </Link>
            );
          }
          return <Fragment key={i}>{segment.displayName}</Fragment>;
        }
        return <Fragment key={i}>{segment.text}</Fragment>;
      })}
    </>
  );
}
