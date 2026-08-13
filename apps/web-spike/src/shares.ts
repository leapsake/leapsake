import { randomUUID } from "node:crypto";
import { bytesToBase64, bytesToUtf8, utf8ToBytes } from "@leapsake/bytes";
import { generateKey, open, seal, unwrapKey, wrapKey } from "@leapsake/crypto";
import type { Milestone } from "@leapsake/schema";
import type { RelationshipPartner } from "@leapsake/ui/web";
import { toBase64Url } from "./base64url.js";

/**
 * The share store — **one `Map`, two flavors, and exactly one line of difference
 * between them** (`plans/encryption/model.md` §11).
 *
 * Both flavors do the identical thing to the content: mint a content key `ck`,
 * `seal` the payload under it, keep the ciphertext. What differs is what happens
 * to `ck` afterwards:
 *
 * - **Capability link** — `ck` is handed to the sharer inside the URL's
 *   `#fragment` and *dropped here*. The fragment is never sent to the server
 *   (RFC 3986 §3.5; the Fetch standard strips it before the request), so this
 *   process cannot read the blob it is storing. Zero-knowledge, and the default
 *   §11 asks for.
 * - **Hosted link** — `ck` is kept, so the server can decrypt and SSR-render.
 *   That is what buys a no-JS viewer, a link preview, and SEO, and it is why the
 *   sharer has to choose it deliberately.
 *
 * ## What the flavors cost, stated where the code shows it
 *
 * A capability key is **shown once and never again**: it exists in this process
 * for the duration of the POST that created it, appears in that response, and is
 * then unrecoverable. Nothing here can re-display an existing link — see
 * `share-new.tsx`, where that turns into a product constraint rather than an
 * implementation detail.
 *
 * A hosted key is stored `wrap(ck, hostKey)` rather than in the clear, mirroring
 * §9.2 Scenario 2 ("wrapped to the server's own keypair") with a symmetric key,
 * for the same reason `session.ts` wraps its master key: it keeps the *store*
 * inert on its own. It is a thinner claim than the session store's, though, and
 * the difference is worth being exact about — the session's wrapping key lives
 * in a browser's cookie jar, so the server genuinely cannot open a session at
 * rest, while `hostKey` lives in this process beside the ciphertext it opens. A
 * hosted share is readable by the server by design; wrapping only means a stolen
 * *store file* is not also a stolen *key file*.
 */

/** The two public-link flavors of §11. */
export type ShareFlavor = "capability" | "hosted";

/**
 * What a share carries: a relationship, reduced to `RelationshipScreen`'s props.
 *
 * A relationship rather than a person because the screen is the spike doc's
 * suggestion and the reason is structural — `RelationshipScreen` has **zero
 * callback props** and renders no form, so it is the one shared screen that can
 * be dropped into an unauthenticated page unchanged. `PersonScreen` takes
 * `onSetObserves`/`onChanged` and would need answers for both.
 */
export interface SharedRelationship {
  relationshipId: string;
  title: string;
  partners: RelationshipPartner[];
  milestones: Milestone[];
}

interface ShareRecord {
  flavor: ShareFlavor;
  /** `seal(utf8ToBytes(JSON.stringify(payload)), ck)` — the only copy of the content. */
  blob: Uint8Array;
  /** `wrap(ck, hostKey)` for a hosted share; **null** for a capability one. */
  wrappedContentKey: Uint8Array | null;
  createdAt: number;
}

const shares = new Map<string, ShareRecord>();

/**
 * The server's own wrapping key — §9.2 Scenario 2's keypair, as one symmetric
 * key because the spike has no second party to wrap to. Process-lifetime, so a
 * restart makes every hosted share undecryptable; a real host persists it in the
 * same place its TLS key lives.
 */
const hostKey = generateKey();

/**
 * Create a share. Returns the id, plus — for a capability link only — the key to
 * put in the fragment, base64url so it survives a URL.
 */
export function createShare(
  flavor: ShareFlavor,
  payload: SharedRelationship,
): { id: string; keyFragment: string | null } {
  const contentKey = generateKey();
  const blob = seal(utf8ToBytes(JSON.stringify(payload)), contentKey);
  const id = randomUUID();

  shares.set(id, {
    flavor,
    blob,
    wrappedContentKey:
      flavor === "hosted" ? wrapKey(contentKey, hostKey) : null,
    createdAt: Date.now(),
  });

  const keyFragment = flavor === "capability" ? toBase64Url(contentKey) : null;
  // The capability flavor's whole claim, in one line: the plaintext key leaves
  // in the return value and this process keeps no copy of it.
  contentKey.fill(0);
  return { id, keyFragment };
}

export function getShare(id: string): ShareRecord | undefined {
  return shares.get(id);
}

/** The ciphertext as it goes into the page, for the client to decrypt. */
export function blobBase64(record: ShareRecord): string {
  return bytesToBase64(record.blob);
}

/**
 * Open a hosted share **on the server** — the ten lines that are the whole
 * difference between the flavors, and the trust boundary §11 warns about.
 */
export function openHostedShare(record: ShareRecord): SharedRelationship {
  if (record.wrappedContentKey === null) {
    throw new Error("not a hosted share — the server holds no key for it");
  }
  const contentKey = unwrapKey(record.wrappedContentKey, hostKey);
  try {
    return JSON.parse(
      bytesToUtf8(open(record.blob, contentKey)),
    ) as SharedRelationship;
  } finally {
    contentKey.fill(0);
  }
}
