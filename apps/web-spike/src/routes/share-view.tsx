import { html, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";
import { blobBase64, getShare } from "../shares.js";

/**
 * **The capability link's page — the server serving something it cannot read.**
 *
 * It is unauthenticated (a share is for someone with no account), it hands over
 * the ciphertext, and it loads `src/client/share.ts`. That is the whole route:
 * the decryption happens in the browser, from a key this process never receives.
 *
 * ## The demonstration, and where to look for it
 *
 * The claim "the fragment is never sent" is not something a server can prove by
 * assertion — it can only *show its input*. So the exact request line lands in
 * the log, and the same string comes back as `x-received-url`, which is what
 * `scripts/share.ts` asserts against. Both are the same evidence: a request for a
 * URL that was typed with `#<key>` on the end arrives here with the `#` and
 * everything after it already gone, because the Fetch standard strips it before
 * the request is built and every browser implements that rule.
 *
 * ## The `<noscript>` is the honest half of §11
 *
 * A capability link is **structurally** incompatible with the no-JS floor. Not
 * "not implemented yet" — impossible, in the way a locked door is impossible to
 * open without its key. So the page says exactly that, and the hosted flavor next
 * door exists precisely because saying it is not always an acceptable answer.
 */
export function shareViewPage(id: string, requestUrl: string): Reply {
  const record = getShare(id);
  if (record === undefined || record.flavor !== "capability") {
    return text(404, "No such share\n");
  }

  const ciphertext = blobBase64(record);
  // The line the findings quote. Printed as received, not reconstructed.
  console.log(
    `share  GET ${requestUrl}  → ${ciphertext.length} B ciphertext, 0 B plaintext`,
  );

  return {
    ...html(
      renderPage({
        title: "Shared with you",
        script: "/src/client/share.ts",
        children: (
          <main>
            <div id="share" data-blob={ciphertext} />
            <p id="share-status">Decrypting…</p>
            <noscript>
              <p>
                This link needs JavaScript, and no amount of server work can
                change that: its key is in the part of the URL after the{" "}
                <code>#</code>, which browsers never send. This server holds only
                ciphertext. Ask for a <strong>hosted link</strong> if you need one
                that works without JavaScript — the trade is that the server can
                then read it.
              </p>
            </noscript>
          </main>
        ),
      }),
    ),
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-received-url": requestUrl,
    },
  };
}
