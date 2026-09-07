// The Android target: Google Play, via a local bundle.
//
// Not built, and **deliberately not buildable yet** (owner, 2026-09-06). Android ships after
// v0.1, published by the company account that does not exist yet — see
// plans/android-pipeline.md.
//
// `status: "blocked"` is doing real work here rather than merely describing an absence. A Play
// package name is claimed permanently by whichever account **first uploads** it, so an upload
// from the personal developer account would bind com.leapsake.app to the wrong account for
// good. This status is the interlock that makes that impossible to do by accident: the release
// refuses the target and says why. Do not flip it to "ready" until the publishing account
// exists, however finished the build half looks.
//
// It shares the version and the build number with iOS by construction — `versionCode` and
// `ios.buildNumber` are the same clock reading from `apps/mobile/app.config.ts` — so the
// two stores can never disagree about which build is newer.
export default {
  id: "android",
  label: "Android (Google Play)",
  status: "blocked",
  note: "after v0.1, from the company Play account — plans/android-pipeline.md",

  preflight: [],

  tiers: {
    alpha: { name: "internal testing track", requires: [] },
    beta: {
      name: "closed testing track",
      requires: [],
      manual: [
        "under a personal account the 14-day/12-tester closed test would start at the first " +
          "upload; the company account this ships from is exempt — plans/android-pipeline.md",
      ],
    },
    rc: { name: "closed testing track (ship-ready)", requires: [] },
    final: { name: "production track", requires: [] },
  },

  async build() {
    throw new Error(
      "the Play build is not scripted yet — see plans/android-pipeline.md",
    );
  },

  async publish() {
    throw new Error(
      "the Play upload is not scripted yet — see plans/android-pipeline.md",
    );
  },
};
