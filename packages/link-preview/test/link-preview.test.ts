import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkPreview, linkPreviewOf } from "../src/index.js";

const PAGE = "https://shop.example.com/p/train-set";

describe("linkPreviewOf", () => {
  it("reads og:title whatever order its attributes come in", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="Train set">', PAGE)
        .title,
    ).toBe("Train set");
    expect(
      linkPreviewOf("<META CONTENT='Train set' Property='og:title' />", PAGE)
        .title,
    ).toBe("Train set");
  });

  it("decodes entities and collapses whitespace", () => {
    const html =
      '<meta content="A&amp;W Women&#x27;s\n  shirt &rsquo;&#8217;" property="og:title"/>';
    expect(linkPreviewOf(html, PAGE).title).toBe("A&W Women's shirt ’’");
  });

  it("leaves an unknown entity as written", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="Fish &chips;">', PAGE)
        .title,
    ).toBe("Fish &chips;");
  });

  it("takes the first og:title when a page repeats it", () => {
    const html =
      '<meta property="og:title" content="First"><meta property="og:title" content="Second">';
    expect(linkPreviewOf(html, PAGE).title).toBe("First");
  });

  it("falls back to the page <title> when there is no og:title", () => {
    expect(linkPreviewOf("<title>Train set</title>", PAGE).title).toBe(
      "Train set",
    );
  });

  it("prefers og:title to the page <title>", () => {
    const html =
      '<title>Buy a train set | Shop</title><meta property="og:title" content="Train set">';
    expect(linkPreviewOf(html, PAGE).title).toBe("Train set");
  });

  it("drops the site's own name from either end of a <title>", () => {
    const amazon = "https://www.amazon.com/dp/B0BSHF7WHW";
    expect(
      linkPreviewOf("<title>Amazon.com: Spooky Village Puzzle</title>", amazon)
        .title,
    ).toBe("Spooky Village Puzzle");
    expect(
      linkPreviewOf("<title>Train set | shop.example.com</title>", PAGE).title,
    ).toBe("Train set");
  });

  it("has no title when the <title> is only the site's name", () => {
    const amazon = "https://www.amazon.com/dp/B0BSHF7WHW";
    expect(linkPreviewOf("<title>Amazon.com</title>", amazon).title).toBeNull();
  });

  it("has no title from a bot wall's <title>", () => {
    for (const wall of [
      "Just a moment...",
      "Just a moment&hellip;",
      "Attention Required! | Cloudflare",
      "Robot Check",
    ]) {
      expect(linkPreviewOf(`<title>${wall}</title>`, PAGE).title).toBeNull();
    }
  });

  it("reads only the <title> in the <head>, not an SVG's in the body", () => {
    const html = "<head></head><body><svg><title>Close</title></svg></body>";
    expect(linkPreviewOf(html, PAGE).title).toBeNull();
  });

  it("reads og:image as an absolute address", () => {
    const image = (content: string) =>
      linkPreviewOf(`<meta property="og:image" content="${content}">`, PAGE)
        .image;
    expect(image("https://cdn.example.com/train.jpg")).toBe(
      "https://cdn.example.com/train.jpg",
    );
    expect(image("/img/train.jpg?w=600&amp;h=600")).toBe(
      "https://shop.example.com/img/train.jpg?w=600&h=600",
    );
    expect(image("//cdn.example.com/train.jpg")).toBe(
      "https://cdn.example.com/train.jpg",
    );
  });

  it("has no image that is not a web address", () => {
    expect(
      linkPreviewOf(
        '<meta property="og:image" content="data:image/png;base64,AA">',
        PAGE,
      ).image,
    ).toBeNull();
    expect(linkPreviewOf("<title>Train set</title>", PAGE).image).toBeNull();
  });

  it("has no title when og:title is blank", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="  ">', PAGE).title,
    ).toBeNull();
  });
});

function serve(body: string, init: ResponseInit) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
}

describe("fetchLinkPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const page =
    '<meta property="og:title" content="Bedford Falls mug"><meta property="og:image" content="mug.jpg">';

  it("reads the og: tags of an HTML page", async () => {
    serve(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    expect(await fetchLinkPreview("https://example.com/mug")).toEqual({
      title: "Bedford Falls mug",
      image: "https://example.com/mug.jpg",
    });
  });

  it("is null for a page that refused the request", async () => {
    serve(page, { status: 403, headers: { "content-type": "text/html" } });
    expect(await fetchLinkPreview("https://example.com/mug")).toBeNull();
  });

  it("is null for something that is not a page", async () => {
    serve("{}", { headers: { "content-type": "application/json" } });
    expect(await fetchLinkPreview("https://example.com/mug")).toBeNull();
  });

  it("is null offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );
    expect(await fetchLinkPreview("https://example.com/mug")).toBeNull();
  });

  it("is null once the caller aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const caller = new AbortController();
    const preview = fetchLinkPreview("https://example.com/mug", caller.signal);
    caller.abort();
    expect(await preview).toBeNull();
  });
});
