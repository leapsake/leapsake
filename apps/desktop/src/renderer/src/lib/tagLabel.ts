/**
 * A tag's display label: its bare stored name with the leading "#" sigil. The
 * "#" is presentation only (like a hashtag) — it's never stored on the tag, so
 * every place that shows a tag routes through here to render it uniformly.
 */
export function tagLabel(name: string): string {
  return `#${name}`;
}
