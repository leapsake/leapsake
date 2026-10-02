# @leapsake/link-preview

What a link's share card would say, read mostly from the page's Open Graph tags (`og:*`).
`fetchLinkPreview(url)` fetches the page from the device itself — no server of ours sits in
between — and `linkPreviewOf(html, pageUrl)` reads HTML already in hand: `og:title`, falling
back to `<title>`, and `og:image` as an absolute address (pages often write it relative to
themselves).

It returns `null` rather than a guess: offline, after an 8-second timeout, for a non-2xx
answer, or for something that is not HTML. A caller then does what it would with no preview
at all, and the person types the name themselves.

## Why `<title>` is read warily

Amazon sets no `og:` tags at all, so `<title>` is the only name its pages carry. But many
shops answer a request that is not a full browser with a bot wall instead of the page:
Cloudflare's "Just a moment…", a queue page, or a bare `etsy.com`. Most of those come back
as a 403 and are rejected for that. The rest are caught by a short list of known wall titles
and by refusing a title that is only the site's own name. The site's name is also trimmed
from either end of a `<title>` ("Amazon.com: …"), since the link already shows where it is
from.

The list will miss walls it has not seen; `test/link-preview.test.ts` is where to add one.

A full browser engine gets past these walls by running their JavaScript, which is how
Messages builds its previews (Apple's LinkPresentation). That would mean a native module
per platform, and it hands back image data rather than an address.

## Where it can run

A browser page cannot fetch an arbitrary shop's HTML: CORS blocks it. React Native's
`fetch` and Node's (Electron's main process) have no CORS, so mobile calls this directly,
and desktop would call it from main over IPC. No dependency: a few regular expressions read
`<meta>` tags, and pure JS runs on Hermes as-is.
