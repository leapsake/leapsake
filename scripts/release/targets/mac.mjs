// The macOS target, blocked until desktop distribution; see
// `scripts/release/README.md` → _The macOS target_.
export default {
  id: "mac",
  label: "macOS (notarized, direct download)",
  platform: "mac",
  host: "macos",
  status: "blocked",
  note: "packaging and notarization deferred past v0.1 — plans/v0-2.md",

  preflight: [],

  tiers: {
    alpha: { name: "unsigned local build", requires: [] },
    beta: { name: "notarized artifact", requires: [] },
    rc: { name: "notarized artifact (ship-ready)", requires: [] },
    final: { name: "published update feed", requires: [] },
  },

  async build() {
    throw new Error(
      "desktop packaging is deferred past v0.1 — see plans/v0-2.md",
    );
  },

  async publish() {
    throw new Error(
      "desktop packaging is deferred past v0.1 — see plans/v0-2.md",
    );
  },
};
