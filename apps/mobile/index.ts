// Entry point. Hermes ships no global `crypto` object at all. The shared packages
// call two Web Crypto standards we must supply: `crypto.randomUUID` (`@leapsake/data`,
// for every primary key) and `crypto.getRandomValues` (`@leapsake/crypto`'s noble
// primitives, for key/salt/recovery-key generation in the enable-sync door). We
// establish the global here from expo-crypto's native implementation — no hand-rolled
// algorithm, just wiring (reboot-plan.md §2: don't reimplement a standard a first-party
// module ships). expo-crypto emits canonical lowercase v4 UUIDs, the same form Node
// (desktop) and browsers (web) produce, so stored IDs carry no platform fingerprint.
// Desktop and web supply `crypto` natively; this is mobile-only.
//
// Note: adding/removing a native module (like expo-crypto) requires a Metro restart
// with `--clear`; a hot reload throws "Cannot find native module".
import * as ExpoCrypto from "expo-crypto";

// `globalThis.crypto` is typed as an always-present `Crypto`; on Hermes it is
// absent. Cast to an optional/partial view, create the object, and fill only the
// members the codebase uses; add others if a need arises.
//
// This MUST run before `expo-router/entry` boots the app, so the polyfill is in
// place before any screen (and the CoreProvider it mounts) touches the data/crypto
// layer.
const globalScope = globalThis as unknown as { crypto?: Partial<Crypto> };
globalScope.crypto ??= {};
globalScope.crypto.randomUUID ??= ExpoCrypto.randomUUID as Crypto["randomUUID"];
globalScope.crypto.getRandomValues ??=
  ExpoCrypto.getRandomValues as Crypto["getRandomValues"];

// expo-router owns the root component; it discovers screens from the `app/`
// directory. (Replaces the prior `registerRootComponent(App)`.)
import "expo-router/entry";
