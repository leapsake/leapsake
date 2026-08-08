# v0.1 · 03 — Store identity, and a proven restore path

> **Delete this doc when the work lands.** The restore procedure it produces is a *deliverable* —
> it belongs in `apps/desktop/README.md` when written, not here.

Two small, cheap, unrelated jobs that both gate [04](./v0-1_04_mobile-pipeline.md). They share a
doc because neither justifies its own and both are pure prerequisites.

## A — Store identity + repo hygiene

**Value:** closes the only permanent, free-to-fix decision on the board. Store version strings
are permanent and monotonic per store record, and stores reject non-numeric strings — so `0.0.0`
and `0.1.0-dev` are both unusable there.

- Pick the real `version` and the versioning scheme for both clients. The *mechanism* is built —
  `scripts/set-version.mjs` writes every manifest and `pnpm test:versions` gates agreement — so
  this is purely the decision.
- Pick a **build-number strategy** (`ios.buildNumber` / `android.versionCode`), which exists
  nowhere yet. EAS can auto-increment them in 04.
- ✅ **Already done:** the credential shapes 04 and 05 introduce (`*.p12`, `AuthKey_*.p8`,
  `*.mobileprovision`, `*.jks`, `*.keystore`, `credentials.json`) are gitignored at the root
  preemptively — cheaper than a history rewrite, and the history goes public in 07.

> **The deadline is 04's first upload, not the v0.1 cut** *(owner, 2026-07-31)*: everything stays
> `0.0.0` until it is actually needed. Do not let this block anything earlier.

**Acceptance:** fresh dev install on **iOS and Android** under `com.leapsake.app` (desktop is a
separate identity, `com.leapsake.desktop`, set in 05); `git status` clean.

**Note:** the new ID is a new app identity, so existing dev installs hold orphaned data under the
old one — uninstall and rebuild the dev client before running `pnpm test:native`.
`scheme: "leapsake"` is unchanged, so `leapsake://` deep links still route.

## B — Verify and document restore-from-backup

**Value:** the answer to *"how do I back up Leapsake?"*, which local-only users — the majority at
v0.1, since sync requires self-hosting — currently do not have. A hard prerequisite of the
individual-first strategy.

✅ **Both doors are built** (custody slice 5) and proved on desktop against a wiped keychain,
including the negatives and the check that a password unlock leaves the recovery sidecar
byte-identical. **What is left is the part that machine could not prove:** the same exercise on a
*fresh machine*, from copied files, written up as the answer.

Confirm end to end, per custody state:

| State | Expected |
|---|---|
| **Unauthenticated store** | copy `leapsake.db`, boot, read the data. No ceremony, no keys |
| **Authenticated, password door** | copy store + sidecars, boot, pass the gate with the password |
| **Authenticated, phrase door** | same with the recovery phrase; then confirm it forces setting a new password afterwards |
| **Negative cases** | wrong password and wrong phrase both rejected, neither corrupting |

Then write it up as *the* backup answer, including the honest limit: an account protects
**access**, a backup protects against **losing the device**.

**Acceptance:** a documented, reproducible restore on a clean macOS user account covering all
four cases. **If any door does not work, this becomes a build increment and everything downstream
waits** — which is exactly why it runs early and cheap.

> Related, and deliberately not blocking: `encryption/model.md` §7.3.1 says Forget-account should
> offer an export first, and today desktop can only tell the user to copy their `stores` folder
> while mobile cannot say even that. The real fix is the vCard exporter, which is
> [`v0-2.md`](./v0-2.md) work.
