/** How long a page gets to answer before its link is left nameless. */
const FETCH_TIMEOUT_MS = 8000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  trade: "™",
  reg: "®",
  copy: "©",
};

/** A page’s Open Graph tags (`og:*`), what its share card is drawn from. */
export interface LinkPreview {
  title: string | null;
}

/** The `og:` tags in a page's HTML; a tag that is absent or blank is `null`. */
export function linkPreviewOf(html: string): LinkPreview {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      ""
    ).toLowerCase();
    const content = attributes.get("content");
    if (key.startsWith("og:") && content !== undefined && !tags.has(key)) {
      tags.set(key, content);
    }
  }
  return { title: cleanText(tags.get("og:title")) };
}

/**
 * Fetch a link and read its `og:` tags. Anything that keeps them from being
 * read — offline, a timeout, a non-2xx answer, a non-HTML page — is `null`.
 */
export async function fetchLinkPreview(
  url: string,
  signal?: AbortSignal,
): Promise<LinkPreview | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort);
  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: "text/html" },
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/html/i.test(type)) return null;
    return linkPreviewOf(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const [, name, double, single, bare] of tag.matchAll(pattern)) {
    attributes.set(name.toLowerCase(), double ?? single ?? bare ?? "");
  }
  return attributes;
}

/** Entities decoded and whitespace collapsed; blank is `null`. */
function cleanText(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    },
  );
}
