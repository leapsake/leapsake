# Leapsake — Product truths (the stable "why it must feel this way")

> **This is a stable posture doc, not a status board.** It holds the durable product
> decisions and the mental model Leapsake must embody — the things that shape *how* every
> increment is built. Live status and sequencing live in [`status.md`](./status.md), which
> never restates what's here; it only sequences the work these truths imply. The
> accessibility principle underneath most of this is in
> [`encryption/model.md`](./encryption/model.md) §1.

## Launch posture (decided 2026-07-05)

- **Laypeople first, power users under the hood.** Defaults must work for someone who has
  never heard of a key or a relay; every stronger-or-different choice is a visible-but-
  optional dial, never a prerequisite.
- **v0.1 ships without a hosted relay.** Multi-device sync users self-host `apps/server`
  (single-device use needs no server at all and stays the layperson-complete path). The
  design still optimizes the layperson flow so nothing needs reworking when the hosted
  relay arrives.
- **Storage/hosting strategy is incremental and reversible:** self-hosted relay (v0.1) →
  official paid hosted relay → user-customizable/BYO storage. Mantra: *simplicity and
  security first, followed closely by total customizability.*
- **v0.2 = photo management**, built as the first consumer of the file-type-agnostic
  encrypted-blob design ([`files.md`](./files.md)) so video/documents/audio later reuse the
  same pattern.

## The user / client / account model (stated 2026-07-11)

The north star: **interact like a typical, centralized SaaS app — but with better
protections and considerations under the hood.** The mechanism must serve this layperson
mental model, not leak through it.

- A **user** uses Leapsake on **one-to-many clients**.
- A **client** hosts **one unauthenticated user OR multiple authenticated users** — never
  multiple *unauthenticated* users on one client.
- A user must be **authenticated to sync** across clients. Single-device / local-only use
  needs no account (and stays fully layperson-complete).
- An authenticated user can **share certain data structures** with another user who **may or
  may not be authenticated** (authenticated recipient = wrap the item key for their public
  key; unauthenticated recipient = capability link with the key in the URL `#fragment`).
- **Shareable data:** People and Pets first; for v0.1 it's acceptable to share at the coarser
  grain that pulls in Milestones, Contact Methods, and Relationships. **Finer per-structure
  granularity is a future iteration.** (Reminders are *not* a share target.)
- A user can **decide whether their data is encrypted — default encrypted.**
- A user should **not have to manage multiple accounts / passwords / recovery keys** when
  using a single device or a single relay. (Account identity is currently per-relay; using
  multiple relays may still mean multiple credentials — see cross-relay reconciliation in
  `status.md` Open questions.)
- **The relay is set per authenticated user/account, not per client.**
- An authenticated user can **"log out" of a client, which removes their data from that
  client** (their data remains safe on the relay / their other clients).

## Deltas vs. the current build (future, none v0.1-blocking)

The model above describes the intended destination. Three parts are *not yet* how the code
works, and are called out so they're conscious deferrals, not surprises:

1. **Multiple authenticated users per client + per-user data isolation.** Today a client is
   implicitly single-user: one keyed SQLite file, one whole-DB key in the enclave. Hosting
   several users on one client needs **separately-keyed per-user stores** so data can't bleed
   and can be purged independently. This is a *global* concern across every entity — new
   entities should not special-case it, only avoid fighting it (plain syncable rows do).
2. **User-toggleable encryption (default on).** The current design is *always* zero-knowledge.
   Opt-**out** is a trust-model fork (trades end-to-end encryption for server-side features
   like server-side search), not a free dial. This argues against per-field content-key
   encryption on new entities; encryption trends toward a user-level **layer** choice.
3. **"Log out = purge from this client"** diverges from the built **Disconnect account**,
   which deliberately *keeps* local data (revokes the password/recovery doors, retains the
   enclave master key → local-only). Both should coexist; the purge becomes mandatory once a
   client hosts multiple users (delta 1).
