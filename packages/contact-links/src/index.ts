export { resolveActions } from "./actions.js";
export type { ContactMethodLike } from "./actions.js";
export {
  PLATFORMS,
  PHONE_PLATFORMS,
  HANDLE_PLATFORMS,
  NATIVE_SCHEMES,
  SCHEME_PROBES,
  findPlatform,
  normalizeFor,
} from "./platforms.js";
export { bareHandle, phoneDigits, phoneE164 } from "./normalize.js";
export type {
  ActionVerb,
  LinkAction,
  Platform,
  PlatformKey,
  PlatformLink,
  Reach,
} from "./types.js";
