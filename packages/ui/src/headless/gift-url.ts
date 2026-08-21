/**
 * Telling a gift's **name** from its **link**, when they share one field.
 *
 * Capturing a gift used to be two inputs, a Gift and a permanently-visible
 * "Link (optional)" under it. But the two are never both typed: a gift is either
 * something you thought of (a name) or something you found (a link you paste and
 * then name). So one field takes both, and this decides which one just arrived —
 * a rule about what a typed string means, not about markup, so both renderers can
 * read it and it can be tested without one.
 */

/**
 * The text as a gift's link, or null if it isn't one.
 *
 * Deliberately strict: only absolute `http(s)` with a host counts. A bare
 * "example.com" is a plausible gift name ("Example.com subscription") and a
 * `mailto:` or `file:` is not a thing to shop from, so both stay names. The URL
 * is returned as typed rather than normalized — what the user pasted is what the
 * link should open, and `new URL` would helpfully rewrite it.
 */
export function giftUrlOf(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).hostname === "" ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * Whether a change to the field arrived **all at once** — a paste rather than a
 * keystroke.
 *
 * This is what stops a hand-typed URL being filed as a link halfway through
 * typing it: `https://e` is already a valid URL by {@link giftUrlOf}, so a field
 * that checked every keystroke would swallow the first nine characters and put
 * the rest in the name. React Native gives no paste event, so the tell is the
 * size of the jump. One character is typing; several at once is not.
 *
 * A deletion is never a paste, however large — selecting the field and pasting
 * over it lands here as a grow from "" and is caught on its own merits.
 */
export function pastedIntoField(previous: string, next: string): boolean {
  return next.length - previous.length > 1;
}

/**
 * How a link is shown once the field has taken it — its host, without the `www.`
 * nobody reads. Falls back to the whole string if it somehow won't parse, since
 * a link the user can't see is worse than an ugly one.
 */
export function giftUrlLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}
