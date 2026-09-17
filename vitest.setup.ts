import { setKdfParamsForTests } from "./packages/crypto/src/kdf.js";

// Every Vitest file derives keys at 64 KiB / one pass instead of the production
// 19 MiB / two passes — see packages/crypto/README.md → *The test cost*.
setKdfParamsForTests({ m: 64, t: 1 });
