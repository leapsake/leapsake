// The macOS target, blocked until desktop distribution; see
// `scripts/release/README.md` → _The macOS target_.
export default {
  id: "mac",
  label: "macOS (notarized, direct download)",
  platform: "mac",
  host: "macos",
  status: "blocked",
  note: "packaging and notarization wait for the iOS transfer — plans/desktop-packaging.md",

  preflight: [],

  tiers: {
    alpha: { name: "unsigned local build", requires: [] },
    beta: { name: "notarized artifact", requires: [] },
    rc: { name: "notarized artifact (ship-ready)", requires: [] },
    final: { name: "published update feed", requires: [] },
  },

  async build() {
    throw new Error(
      "desktop packaging waits for the iOS transfer — see plans/desktop-packaging.md",
    );
  },

  async publish() {
    throw new Error(
      "desktop packaging waits for the iOS transfer — see plans/desktop-packaging.md",
    );
  },
};
