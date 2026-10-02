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

/** Tidying a shop's titles need beyond losing its name, by its domain label. */
const SITE_TITLE_TIDIES: Record<string, (title: string) => string> = {
  // "…Space Gray : Electronics": the department follows a spaced colon.
  amazon: (title) => {
    // A book's, "Dune: 9780441172719: Herbert, Frank: Books", keeps its author.
    const isbn = /:\s*(?:\d{13}|\d{9}[\dX])\s*(?=:)/;
    return isbn.test(title)
      ? title.replace(isbn, "").replace(/\s*:\s*[^:]+$/, "")
      : title.replace(/\s+:\s+[^:]+$/, "");
  },
  apple: (title) => title.replace(/^buy\s+/i, ""),
};

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
    title: productTitleOf(
      cleanText(tags.get("og:title")) ?? documentTitleOf(html),
      pageUrl,
    ),
    image: absoluteWebUrl(cleanText(tags.get("og:image")), pageUrl),
  };
}

/**
 * A link's preview, the page asked for in `languages` (BCP 47, best first).
 * Offline, a timeout, a non-2xx answer or a non-HTML page is `null`.
 */
export async function fetchLinkPreview(
  url: string,
  {
    signal,
    languages = [],
  }: { signal?: AbortSignal; languages?: readonly string[] } = {},
): Promise<LinkPreview | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort);
  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: {
        Accept: "text/html",
        // Amazon answers a request without one with a CAPTCHA.
        "Accept-Language": languages.length > 0 ? languages.join(", ") : "en",
      },
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

/** The `<title>` in the page's `<head>`, not an SVG's in its body. */
function documentTitleOf(html: string): string | null {
  const head = html.split(/<\/head>/i)[0];
  return cleanText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]);
}

/**
 * A page title without the shop's name at either end ("Amazon.com: …",
 * "… | eBay"); a bot wall's, or the shop's name alone, is `null`.
 */
function productTitleOf(title: string | null, pageUrl: string): string | null {
  if (title === null || BOT_WALL_TITLES.has(title.toLowerCase())) return null;
  const site = siteOf(pageUrl);
  if (site === null) return title;

  const name = String.raw`(?:[a-z0-9-]+\.)*${site.label}(?:${site.suffix.replaceAll(".", String.raw`\.`)})?`;
  const separator = String.raw`(?:\s*:\s+|\s+[|\-–—·]\s+)`;
  const trimmed = title
    .replace(new RegExp(`^${name}${separator}`, "i"), "")
    .replace(new RegExp(`${separator}${name}$`, "i"), "");
  const tidied = (SITE_TITLE_TIDIES[site.label]?.(trimmed) ?? trimmed).trim();
  return tidied === "" || new RegExp(`^${name}$`, "i").test(tidied)
    ? null
    : tidied;
}

/**
 * A shop's domain split at its name: `amazon` and `.co.uk` for
 * `www.amazon.co.uk`. The name is the label left of a short final suffix.
 */
function siteOf(pageUrl: string): { label: string; suffix: string } | null {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const match = /([a-z0-9-]+)((?:\.[a-z]{2,3})?\.[a-z]{2,})$/.exec(host);
  return match === null ? null : { label: match[1], suffix: match[2] };
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
