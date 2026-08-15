# @leapsake/store-layout

**Where this client keeps its stores, and which one to open.** This package owns the
on-device layout that _"encryption follows custody"_ requires
([`plans/encryption/model.md`](../../plans/encryption/model.md) §7.2, §7.4): the account
**roster**, the **per-account store paths**, and the pure decision of whether a launch is
**Unauthenticated** or **Authenticated**.

| State               | Account | Keys in the OS keychain  | Store on disk        |
| ------------------- | ------- | ------------------------ | -------------------- |
| **Unauthenticated** | none    | **none at all**          | plaintext, queryable |
| **Authenticated**   | yes     | db-key, master, recovery | encrypted            |

The state names the **account**; `resolveActiveStore` reports the **file** separately as
`custody: "plaintext" | "encrypted"`. They agree today because encryption follows custody,
and they are named apart because `plans/v0-2.md` expects that to change. See
[`AGENTS.md`](../../AGENTS.md) → _Custody vocabulary_ for all three axes.

## The layout *(direction, 2026-07-26)*

A client holds **one Unauthenticated store or many Authenticated ones** — the same shape
[`@leapsake/key-custody`](../key-custody/README.md) states for users. Each account gets its
**own encrypted database file**, which is what makes per-user isolation and **Forget account**
clean rather than surgical:

```
<userData>/stores/
  local/leapsake.db                  ← the Unauthenticated store (plaintext), before any account
  <accountId>/leapsake.db            ← one encrypted store per account on this client
  <accountId>/leapsake.db.recovery   ← its sidecars (recovery + password doors)
<userData>/accounts.json             ← the roster: which accounts exist on this client
```

- **Creating an account** writes `stores/<accountId>/` and removes `stores/local/`.
- **Logging out** deletes `stores/<accountId>/` and its roster entry. Nothing to sift.
- **The roster must be readable before any store opens** — you cannot enumerate accounts from
  inside files you cannot decrypt — so it is unencrypted. See *The rules worth knowing*.

## Why it is its own package

It is read on the **boot path, before anything is opened** — the roster is what tells a
launch whether to mint keys at all. That forces two properties:

- **No filesystem, no crypto.** Everything is either a pure string derivation or logic
  over an injected `RosterStorage` port. Desktop backs that port with a JSON file under
  `userData`; mobile has no general filesystem dependency and backs it with an
  unencrypted SQLite database (the same shape as its recovery sidecar); tests use memory.
- **It cannot import `core`.** Core is composed _after_ the store is open, so anything on
  this side of that line has to stand alone.

## Surface

| Export                       | What it answers                                                                |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `resolveActiveStore`         | Unauthenticated or Authenticated, and which store — the whole custody decision |
| `storePath` / `storeDir`     | where one account's store lives, relative to the app-data root                 |
| `createAccountRoster`        | which accounts exist on this device                                            |
| `ROSTER_PATH`                | where the roster itself lives                                                  |
| `UNAUTHENTICATED_STORE_SLOT` | the reserved slot the accountless store occupies                               |

## The rules worth knowing

**Nothing outside this package should spell out a store path.** The design's load-bearing
line is _"new work must not assume a single fixed database path"_ — cheap to honor now,
expensive once real users have data. `paths.ts` is the only place the string
`leapsake.db` appears.

**The roster is unencrypted, and that is not an oversight.** You cannot enumerate accounts
from inside files you cannot decrypt, so it necessarily leaks the usernames present on the
device. Accepted and unavoidable: a login picker has to render.

**A corrupt roster degrades to empty rather than throwing.** It is parsed before any UI
exists to report an error, so a boot crash would be unrecoverable while "no accounts"
merely opens the Unauthenticated store. The stores themselves are untouched either way — only the
_index_ of them is lost.

**There is no pre-custody compatibility path, deliberately.** Builds before the custody
work encrypted unconditionally at a bare `leapsake.db`. `resolveActiveStore` briefly
detected and kept opening that file; the branch was removed once it was settled that
pre-v0.1 breaking changes are acceptable (owner, 2026-07-27). It bought only "a dev profile
need not be recreated" and cost a compatibility path through the most delicate code in the
app — including a mobile heuristic that inferred _"a store is encrypted"_ from the presence
of a key or a sidecar. **An install predating the custody work must be recreated.**

**A store in the wrong custody state is refused, never silently fixed.** Encrypted where an
Unauthenticated store belongs, or plaintext where an account's store belongs, both raise. The
alternative — converting on the fly — is what the old boot path did, and it is precisely
what §8.1 reserves for the deliberate conversion at account creation.

## What is deliberately _not_ here

Minting keys, converting a plaintext store to an encrypted one (§8.1), and the
account-creation flow. This package decides _which_ store and _whether_ it is encrypted;
`@leapsake/key-custody` and the clients' boot paths do the work that follows.
