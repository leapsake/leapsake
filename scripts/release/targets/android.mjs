// The Android target: Google Play, via a local bundle.
//
// The build half is done: `apps/mobile/plugins/with-android-release-signing.js` puts a real
// `release` signingConfig into the generated project, and `./gradlew bundleRelease` produces an
// AAB signed with the Play upload key (2026-09-13). **The upload half is not written**, which is
// the whole of why this is still `blocked` — see plans/android-pipeline.md.
//
// ⚠️ **This file used to justify `blocked` with a claim that is false** (corrected 2026-09-13,
// against Google's own support pages): that a Play package name is claimed *permanently* by
// whichever account first uploads it, making an upload from the personal account unrecoverable.
// App transfers move the package name, users, ratings and the app signing key for $25 and about
// two business days — provided the receiving account never requests a key upgrade. So this
// status is no longer an interlock protecting against an irreversible act; it describes an
// absence, which is all it ever needed to do.
//
// ⚠️ Flipping it to "ready" is not only about finishing `publish()`. A ready target ships on
// every tag, so `pnpm release beta` would ship Android too — and Android cannot reach production
// on this account. Which track each rung maps to has to be settled first.
//
// It shares the version and the build number with iOS by construction — `versionCode` and
// `ios.buildNumber` are the same clock reading from `apps/mobile/app.config.ts` — so the
// two stores can never disagree about which build is newer.
export default {
  id: "android",
  label: "Android (Google Play)",
  status: "blocked",
  note: "the Play upload is not scripted yet — plans/android-pipeline.md",

  preflight: [],

  tiers: {
    alpha: { name: "internal testing track", requires: [] },
    beta: {
      name: "closed testing track",
      requires: [],
      manual: [
        "the 12-tester/14-day closed test gates *production access* for personal accounts " +
          "created after 2023-11-13 (ours) — and this rung's closed-track uploads are what " +
          "earn it, so shipping betas is the path to production rather than a detour around " +
          "it. 12 Google accounts, opted in, for 14 continuous days",
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
