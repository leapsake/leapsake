/**
 * Reduce whatever the user typed to the bare handle a URL template can take.
 *
 * People paste profile URLs as often as they type handles, and they type the
 * `@` because that is how a handle is *written* even though it is never part of
 * the handle itself. Both are accepted rather than rejected — the same
 * permissive stance the rest of the contact-method schema takes toward real
 * input — so this strips a URL down to its last meaningful path segment, drops
 * a leading `@`, and drops the query and fragment.
 *
 * Case is preserved: `@JoshSmith` is how the person writes their own name and
 * platforms treat handles case-insensitively, so lowercasing would only make the
 * row uglier. The lookup key is normalized separately (see `normalizeHandle` in
 * `@leapsake/schema`).
 */
export function bareHandle(raw: string): string {
  let value = raw.trim();
  if (value === "") return "";

  // A pasted URL: keep the last non-empty path segment, which is the handle on
  // every first-class platform (`/josh`, `/@josh`, `/in/josh`, `/profile/josh`).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//")) {
    const path = value.replace(/^[^:]*:\/\//, "").replace(/^\/\//, "");
    const segments = path
      .split(/[?#]/, 1)[0]
      .split("/")
      .slice(1) // drop the host
      .filter((segment) => segment !== "");
    value = segments.at(-1) ?? "";
  } else {
    value = value.split(/[?#]/, 1)[0];
  }

  return value.replace(/^@+/, "").replace(/\/+$/, "").trim();
}

/**
 * A phone number as the digits a `wa.me`-style URL wants: no `+`, no spaces, no
 * punctuation. Best-effort by the same logic as `normalizePhone` in
 * `@leapsake/schema` — a number the user typed nationally has no country code to
 * find, and guessing one would be worse than handing the platform what we have.
 */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * A phone number in the `+<digits>` shape `signal.me` and friends expect. The
 * `+` is added unconditionally: a number stored without a country code cannot be
 * dialled internationally anyway, and the platform rejecting it is a clearer
 * outcome than a link that silently opens the wrong conversation.
 */
export function phoneE164(raw: string): string {
  const digits = phoneDigits(raw);
  return digits === "" ? "" : `+${digits}`;
}

/** Percent-encode a value for use inside a URL path segment or query value. */
export function encode(value: string): string {
  return encodeURIComponent(value);
}
