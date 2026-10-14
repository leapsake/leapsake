import { normalizeTagName } from "@leapsake/schema";

/** Tag text colours: none blue, so a tag never reads as a mention or link. */
export const TAG_COLORS = [
  "#b42318", // red
  "#b54708", // orange
  "#8a5a00", // amber
  "#3f6b0a", // green
  "#0b6e55", // teal
  "#8b2fc9", // purple
  "#a21caf", // magenta
  "#be185d", // pink
] as const;

/** A tag's colour, `#` optional: the same for every spelling of its name, on
 *  every device. */
export function tagColor(name: string): string {
  const key = normalizeTagName(name.replace(/^#/u, ""));
  // FNV-1a over the code points.
  let hash = 2166136261;
  for (const ch of key) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}
