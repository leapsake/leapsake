// The macOS target: a notarized artifact plus an update feed.
//
// Not built, and **not part of v0.1** — desktop distribution moved out of the first
// release (plans/v0-2.md). The app itself is very much alive; it is the *shipping* of it
// that is deferred, and the integration tier still runs against its real SQLite engine.
//
// Worth recording, because it is easy to assume otherwise from the iOS target next door:
// **Xcode is not in this path at all.** The app is Electron, so packaging is
// electron-builder and the Apple half is `codesign` → `xcrun notarytool submit --wait` →
// `xcrun stapler staple` → `spctl -a -vvv -t exec`, all of which live in the Command Line
// Tools. The same App Store Connect key the iOS target uses authenticates notarization.
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
