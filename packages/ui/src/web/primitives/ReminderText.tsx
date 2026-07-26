import {
  type ResolvedMention,
  type Tag,
  normalizeTagName,
  splitAnnotatedText,
} from "@leapsake/schema";
import { Fragment } from "react";
import { entityBasePath } from "../../headless/routes.js";
import { useUi } from "../adapter.js";

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
 *
 * The text itself is user content, so nothing here comes from the catalog.
 */
export function ReminderText({
  text,
  tags,
  mentions,
}: {
  text: string;
  tags: readonly Tag[];
  mentions: readonly ResolvedMention[];
}) {
  const { Link } = useUi();
  const tagIdByName = new Map(tags.map((tag) => [tag.normalized, tag.id]));
  const labelByTarget = new Map(
    mentions.map((m) => [`${m.targetType}:${m.targetId}`, m.label]),
  );

  return (
    <>
      {splitAnnotatedText(text).map((segment, i) => {
        if (segment.kind === "hashtag") {
          const id = tagIdByName.get(normalizeTagName(segment.tagName));
          return id === undefined ? (
            <Fragment key={i}>{segment.text}</Fragment>
          ) : (
            <Link key={i} href={`/tags/${id}`}>
              {segment.text}
            </Link>
          );
        }
        if (segment.kind === "mention") {
          const label = labelByTarget.get(
            `${segment.targetType}:${segment.targetId}`,
          );
          if (typeof label === "string") {
            return (
              <Link
                key={i}
                href={`${entityBasePath(segment.targetType)}/${segment.targetId}`}
              >
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
