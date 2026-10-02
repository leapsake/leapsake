# @leapsake/link-preview

What a link's share card would say, read from the page's Open Graph tags (`og:*`).
`fetchLinkPreview(url)` fetches the page from the device itself — no server of ours sits in
between — and `linkPreviewOf(html)` reads the tags out of HTML already in hand. Only the
title is read today; `og:image` would be the next tag.

It returns `null` rather than a guess: offline, after an 8-second timeout, for a non-2xx
answer, or for something that is not HTML. A caller then does what it would with no preview
at all, and the person types the name themselves.

## Why only `og:` tags, and never `<title>`

Many shops answer a request that is not a full browser with a bot wall: Cloudflare's
"Just a moment…", a queue page, or a bare `etsy.com`. Those pages have a `<title>` but no
`og:title`, so reading only the share-card tags rejects them for free. A page that sets no
`og:title` is left for the person to name.

## Where it can run

A browser page cannot fetch an arbitrary shop's HTML: CORS blocks it. React Native's
`fetch` and Node's (Electron's main process) have no CORS, so mobile calls this directly,
and desktop would call it from main over IPC. No dependency: a few regular expressions read
`<meta>` tags, and pure JS runs on Hermes as-is.
