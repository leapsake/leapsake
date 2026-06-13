// Entry point. Hermes ships no global `crypto` object at all. The shared packages
// (`@leapsake/data`) call the `crypto.randomUUID` Web Standard for every primary
// key, so we establish that global here from expo-crypto's native implementation —
// no hand-rolled algorithm, just wiring (reboot-plan.md §2: don't reimplement a
// standard a first-party module ships). expo-crypto emits canonical lowercase v4,
// the same form Node (desktop) and browsers (web) produce, so stored IDs carry no
// platform fingerprint. Desktop and web supply `crypto` natively; this is mobile-only.
//
// Note: adding/removing a native module (like expo-crypto) requires a Metro restart
// with `--clear`; a hot reload throws "Cannot find native module".
import * as ExpoCrypto from "expo-crypto";

// `globalThis.crypto` is typed as an always-present `Crypto`; on Hermes it is
// absent. Cast to an optional/partial view, create the object, and fill only the
// one member the codebase uses (`randomUUID`); add others if a need arises.
//
// This MUST run before `expo-router/entry` boots the app, so the polyfill is in
// place before any screen (and the CoreProvider it mounts) touches the data layer.
const globalScope = globalThis as unknown as { crypto?: Partial<Crypto> };
globalScope.crypto ??= {};
globalScope.crypto.randomUUID ??= ExpoCrypto.randomUUID as Crypto["randomUUID"];

// expo-router owns the root component; it discovers screens from the `app/`
// directory. (Replaces the prior `registerRootComponent(App)`.)
import "expo-router/entry";
