# @leapsake/schema

The single source of truth for the domain: **Zod schemas → inferred TypeScript types**, plus
the **pure, portable domain logic**. Zero platform dependencies — it runs identically on
Node, Electron, and React Native (Hermes), so every client formats and reasons about the
domain the same way. It is the base of the dependency chain: `schema → data → core → clients`.

## Why Zod is the single source of truth

Schemas live here; types are **inferred** (never hand-written). The same schema validates at
**every trust boundary over the project's life**: IPC (renderer→main), sync payloads (V3),
and the server (V3). One definition replaces hand-written guards in several places — it earns
its keep as the one validation dependency.

## Domain naming: People, not Contacts

The core entity is **`Person`** (table `people`). A "contact" is an abstraction _over_ a
person; the app may also hold people who aren't contacts. **`Pet`** is first-class alongside
Person. Use `Person` / `people` / `peopleRepo` consistently.

## What's in here

- **Entity schemas + create/update inputs** — Person, Pet, Tag/tagging, relationship,
  dismissal, milestone, the three contact-method types, and the V3 account/key/sync tables.
  The DB is `snake_case`; repositories map to camelCase.
- **Pure domain logic**, shared so every client behaves identically: name/label formatters,
  gender derivation, relationship-role algebra (`inverseRole`, `genderedVariant`,
  `composeRoles`, …), milestone date precision, contact-method normalization, search folding.
- **Merge primitives** — `resolveMerge` (whole-row last-writer-wins on `updatedAt` +
  tombstones: the _same-id_ merge that sync converges with) and `scoreDuplicate` (the
  _distinct-id_ duplicate detector). The two-kinds-of-merge framing is in
  [`packages/core`](../core/README.md).

## Constraints

- **Value constraints (enums, partial-date rules) live here, not in the DB** — so the same
  portable SQL runs on `node:sqlite` (desktop) and expo-sqlite (mobile).
- **Runs on the Hermes floor** (see [`AGENTS.md`](../../AGENTS.md)) — no ES2023-only methods
  (e.g. `Array#toSorted`) in shared code; host capabilities like `crypto.randomUUID` are
  established at each app's entry, not assumed here.
