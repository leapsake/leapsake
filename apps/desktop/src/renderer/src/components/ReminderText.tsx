import { Fragment } from "react";
import { type Tag, normalizeTagName, splitHashtags } from "@leapsake/schema";
import { Link } from "react-router-dom";

/**
 * Render freeform reminder text with its inline `#tags` linked to their tag
 * pages. The reminder's resolved {@link Tag}s supply the ids (keyed by their
 * normalized name); a `#token` with no matching stored tag — which shouldn't
 * happen, since a reminder's tags are derived from this very text — falls back to
 * plain text. Segment order is stable, so the array index is a safe key.
 */
export function ReminderText({ text, tags }: { text: string; tags: Tag[] }) {
  const idByName = new Map(tags.map((tag) => [tag.normalized, tag.id]));
  return (
    <>
      {splitHashtags(text).map((segment, i) => {
        const id =
          segment.tagName !== null
            ? idByName.get(normalizeTagName(segment.tagName))
            : undefined;
        return id !== undefined ? (
          <Link key={i} to={`/tags/${id}`}>
            {segment.text}
          </Link>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        );
      })}
    </>
  );
}
