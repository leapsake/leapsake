// Telling a gift's name from its link, when one field takes both.

/** The text as typed if it is an absolute `http(s)` URL with a host. */
export function giftUrlOf(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).hostname === "" ? null : trimmed;
  } catch {
    return null;
  }
}

/** Whether the field grew by more than one character at once: a paste. */
export function pastedIntoField(previous: string, next: string): boolean {
  return next.length - previous.length > 1;
}

/** A link's host without `www.`, or the whole string if it won't parse. */
export function giftUrlLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** What text shared into the app starts a gift with: its first link, or else
 *  the text itself on one line as the name. `null` for blank text. */
export function sharedGiftOf(
  text: string,
): { url: string } | { title: string } | null {
  const words = text.trim().split(/\s+/);
  for (const word of words) {
    const url = giftUrlOf(word);
    if (url !== null) return { url };
  }
  const title = words.join(" ");
  return title === "" ? null : { title };
}
