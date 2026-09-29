// The targets a release ships to: a file here plus a line below. The shape
// is in `scripts/release/README.md` → _Adding a target_.
import android from "./android.mjs";
import ios from "./ios.mjs";
import mac from "./mac.mjs";

/** Reported in this order. */
export const TARGETS = [ios, android, mac];

export const targetById = (id) => TARGETS.find((target) => target.id === id);
