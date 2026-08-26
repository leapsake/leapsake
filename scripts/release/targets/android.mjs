// The Android target: Google Play, via a local bundle.
//
// Not built. It is nonetheless the **longest lead time in v0.1**: Play's closed-test
// requirement runs for 14 days and the clock does not start until a build is uploaded, so
// this target gates the release date more than the iOS one does.
//
// It shares the version and the build number with iOS by construction — `versionCode` and
// `ios.buildNumber` are the same clock reading from `apps/mobile/app.config.ts` — so the
// two stores can never disagree about which build is newer.
export default {
  id: "android",
  label: "Android (Google Play)",
  status: "blocked",
  note: "bundle/sign/upload not scripted yet — plans/v0-1_04_mobile-pipeline.md",

  preflight: [],

  tiers: {
    alpha: { name: "internal testing track", requires: [] },
    beta: {
      name: "closed testing track",
      requires: [],
      manual: [
        "the 14-day closed test starts at the first upload, and needs 12 testers",
      ],
    },
    rc: { name: "closed testing track (ship-ready)", requires: [] },
    final: { name: "production track", requires: [] },
  },

  async build() {
    throw new Error(
      "the Play build is not scripted yet — see plans/v0-1_04_mobile-pipeline.md",
    );
  },

  async publish() {
    throw new Error(
      "the Play upload is not scripted yet — see plans/v0-1_04_mobile-pipeline.md",
    );
  },
};
