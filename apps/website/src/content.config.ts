import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

/**
 * The legal documents, read from where they already live.
 *
 * `PRIVACY.md` stays at the repo root and is rendered from there rather than copied
 * here. Its own header states the invariant this preserves: every claim in it is
 * checked against the shipped build, so "if the app gains a network call, an SDK, a
 * permission, or reaches a relay, this file changes in the same commit". A copy on
 * the website would be a second place that promise could be kept — or missed. Being
 * one repo is what makes this free; there is no sync step and nothing to drift.
 *
 * The loader's `base` is relative to this Astro project (`apps/website`), so `../..`
 * is the repository root.
 */
const legal = defineCollection({
  loader: glob({ pattern: "PRIVACY.md", base: "../.." }),
});

export const collections = { legal };
