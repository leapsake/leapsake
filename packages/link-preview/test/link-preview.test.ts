import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkPreview, linkPreviewOf } from "../src/index.js";

describe("linkPreviewOf", () => {
  it("reads og:title whatever order its attributes come in", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="Train set">').title,
    ).toBe("Train set");
    expect(
      linkPreviewOf("<META CONTENT='Train set' Property='og:title' />").title,
    ).toBe("Train set");
  });

  it("decodes entities and collapses whitespace", () => {
    const html =
      '<meta content="A&amp;W Women&#x27;s\n  shirt &rsquo;&#8217;" property="og:title"/>';
    expect(linkPreviewOf(html).title).toBe("A&W Women's shirt ’’");
  });

  it("leaves an unknown entity as written", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="Fish &chips;">').title,
    ).toBe("Fish &chips;");
  });

  it("takes the first og:title when a page repeats it", () => {
    const html =
      '<meta property="og:title" content="First"><meta property="og:title" content="Second">';
    expect(linkPreviewOf(html).title).toBe("First");
  });

  it("ignores the page <title>, which bot walls fill with their own", () => {
    expect(linkPreviewOf("<title>Just a moment...</title>").title).toBeNull();
  });

  it("has no title when og:title is blank", () => {
    expect(
      linkPreviewOf('<meta property="og:title" content="  ">').title,
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

  const page = '<meta property="og:title" content="Bedford Falls mug">';

  it("reads the og: tags of an HTML page", async () => {
    serve(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    expect(await fetchLinkPreview("https://example.com/mug")).toEqual({
      title: "Bedford Falls mug",
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
