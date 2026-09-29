/** Reduces a typed handle or pasted URL to the bare handle, keeping its case;
 *  see the README. */
export function bareHandle(raw: string): string {
  let value = raw.trim();
  if (value === "") return "";

  // A pasted URL's last non-empty path segment is the handle everywhere.
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

/** A number as bare digits for a `wa.me` URL, never guessing a country code. */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** A number as `+<digits>` for `signal.me` and friends, `+` added always. */
export function phoneE164(raw: string): string {
  const digits = phoneDigits(raw);
  return digits === "" ? "" : `+${digits}`;
}

/** Percent-encodes a value for a URL path segment or query value. */
export function encode(value: string): string {
  return encodeURIComponent(value);
}
