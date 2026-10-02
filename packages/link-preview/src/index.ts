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

/** Titles of pages that stand in for the real one while checking for bots. */
const BOT_WALL_TITLES = new Set([
  "just a moment...",
  "just a moment…",
  "attention required! | cloudflare",
  "access denied",
  "robot check",
  "hang tight! routing to checkout...",
]);

/** What a link's share card would say, mostly from its `og:` tags. */
export interface LinkPreview {
  title: string | null;
  /** An absolute http(s) address, however the page wrote it. */
  image: string | null;
}

/**
 * The `og:` tags in the HTML of the page at `pageUrl`, the title falling back
 * to `<title>`; anything absent or blank is `null`.
 */
export function linkPreviewOf(html: string, pageUrl: string): LinkPreview {
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
  return {
    title: cleanText(tags.get("og:title")) ?? documentTitleOf(html, pageUrl),
    image: absoluteWebUrl(cleanText(tags.get("og:image")), pageUrl),
  };
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
    return linkPreviewOf(await response.text(), response.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * The `<title>` in the page's `<head>`, without a leading or trailing site
 * name ("Amazon.com: …"). A bot wall's, or the bare site name, is `null`.
 */
function documentTitleOf(html: string, pageUrl: string): string | null {
  const head = html.split(/<\/head>/i)[0];
  const title = cleanText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]);
  if (title === null || BOT_WALL_TITLES.has(title.toLowerCase())) return null;

  const site = hostOf(pageUrl);
  if (site === "") return title;
  const name = site.replaceAll(".", String.raw`\.`);
  const separator = String.raw`\s*[:|\-–—]\s*`;
  const trimmed = title
    .replace(new RegExp(`^${name}${separator}`, "i"), "")
    .replace(new RegExp(`${separator}${name}$`, "i"), "");
  return trimmed === "" || trimmed.toLowerCase() === site ? null : trimmed;
}

/** The page's host, lowercase and without `www.`. */
function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
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

function absoluteWebUrl(href: string | null, base: string): string | null {
  if (href === null) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
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
