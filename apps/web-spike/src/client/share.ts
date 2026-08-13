import { base64ToBytes, bytesToUtf8 } from "@leapsake/bytes";
import { open } from "@leapsake/crypto";
import { fromBase64Url } from "../base64url.js";
import type { SharedRelationship } from "../shares.js";

/**
 * **The client half of a capability link** — the only JavaScript the spike
 * ships, and the only place in it where decryption happens in a browser.
 *
 * The page it runs on carries the ciphertext in an attribute and nothing else;
 * the key arrives in `location.hash`, which the browser never put on the wire.
 * So this file is the entire zero-knowledge claim, and it is deliberately small
 * enough to read in one sitting.
 *
 * ## Why it is bundled through Vite rather than hand-written
 *
 * It imports `@leapsake/crypto` and `@leapsake/bytes` **as the real packages**,
 * which is the point: it is a five-minute early warning on Increment 5's biggest
 * assumption, that the shared crypto compiles to a browser target at all. A
 * hand-rolled WebCrypto call here would have proved nothing about the packages a
 * browser client would actually depend on.
 *
 * ## Why plain DOM rather than React
 *
 * `hosted-view.tsx` renders the same payload through the shared
 * `RelationshipScreen`, so the "is the shared UI reusable unauthenticated?"
 * question is already answered on the server side, where it costs nothing.
 * Doing it *here* would drag React into the bundle for a question Increment 5
 * owns — `scripts/share.ts` builds that variant anyway, purely to report what it
 * weighs.
 */

/**
 * Ciphertext + fragment → the payload. Exported and side-effect-free so the
 * verification script can run the identical function server-side; the DOM work
 * below is what the browser adds, not what the decrypt needs.
 */
export function decodeShare(
  blobBase64: string,
  fragment: string,
): SharedRelationship {
  const key = fromBase64Url(fragment.replace(/^#/, ""));
  const plaintext = open(base64ToBytes(blobBase64), key);
  return JSON.parse(bytesToUtf8(plaintext)) as SharedRelationship;
}

function render(): void {
  const host = document.getElementById("share");
  const status = document.getElementById("share-status");
  if (host === null || status === null) return;

  const blob = host.getAttribute("data-blob") ?? "";
  // No fragment means someone opened the link without its key — which is what a
  // revoked, truncated, or forwarded-without-the-hash link looks like, and the
  // page has to say so rather than appear broken.
  if (location.hash.length < 2) {
    status.textContent =
      "This link is missing its key. The key travels in the part of the URL " +
      "after the #, which is never sent to the server — so a link copied " +
      "without it cannot be opened by anyone, including us.";
    return;
  }

  let payload: SharedRelationship;
  try {
    payload = decodeShare(blob, location.hash);
  } catch {
    // AEAD fails closed, so a wrong key is an exception rather than garbage.
    status.textContent = "That key does not open this link.";
    return;
  }

  status.textContent = `Decrypted in your browser — ${blob.length} bytes of ciphertext.`;

  const heading = document.createElement("h1");
  heading.textContent = payload.title;
  host.appendChild(heading);

  const partners = document.createElement("ul");
  for (const partner of payload.partners) {
    const row = document.createElement("li");
    row.textContent = `${partner.roleLabel}: ${partner.label}`;
    partners.appendChild(row);
  }
  host.appendChild(partners);

  const milestones = document.createElement("ul");
  for (const milestone of payload.milestones) {
    const row = document.createElement("li");
    const date = [milestone.year, milestone.month, milestone.day]
      .filter((part) => part !== null)
      .join("-");
    row.textContent = `${milestone.kind} ${date}`;
    milestones.appendChild(row);
  }
  host.appendChild(milestones);
}

// Guarded so `decodeShare` can be imported from Node — the verification script
// does exactly that, and an unguarded top-level `document` would make the import
// itself throw.
if (typeof document !== "undefined") render();
