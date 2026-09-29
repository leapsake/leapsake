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
 * Reminder text with its tags and mentions linked, each mention by its
 * target's current name; anything unresolved stays plain text.
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
                @{label}
              </Link>
            );
          }
          return <Fragment key={i}>@{segment.displayName}</Fragment>;
        }
        return <Fragment key={i}>{segment.text}</Fragment>;
      })}
    </>
  );
}
