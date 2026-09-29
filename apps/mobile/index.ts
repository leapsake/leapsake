// Hermes has no global `crypto`, so it is built here from expo-crypto
// (`packages/README.md` → These packages run on the Hermes floor).
import * as ExpoCrypto from "expo-crypto";

// Typed as always present, but absent on Hermes. Must run before
// `expo-router/entry` boots anything that touches the data layer.
const globalScope = globalThis as unknown as { crypto?: Partial<Crypto> };
globalScope.crypto ??= {};
globalScope.crypto.randomUUID ??= ExpoCrypto.randomUUID as Crypto["randomUUID"];
globalScope.crypto.getRandomValues ??=
  ExpoCrypto.getRandomValues as Crypto["getRandomValues"];

// expo-router owns the root component, discovering screens in `app/`.
import "expo-router/entry";
