# patches/

Dependency patches applied by pnpm (`patchedDependencies` in the root `package.json`).
Each one is a bug fix we could not wait on upstream for. Drop it when upstream ships the fix.

| Patch | What it fixes | Proven by |
|---|---|---|
| `expo-modules-core@56.0.16` | Android's `SharedObjectRegistry` reads its map without the lock that guards writes, so an async call resolving an id on a background thread can miss a live object during a rehash (`ERR_INVALID_SHARED_OBJECT_ID` / `ERR_USING_RELEASED_SHARED_OBJECT`). iOS already locks every read. | `apps/mobile/test/shared-object-race-selftest.ts` |
