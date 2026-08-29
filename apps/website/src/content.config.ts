import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "zod";

import { docsLoader } from "./lib/docs";

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

/**
 * The taxonomy a doc's URL is built from, and the whole of it.
 *
 * A closed set rather than free text, for two reasons. It is the only place the
 * shape of the help site is written down, so it stays legible as one list; and it
 * doubles as the reserved-word check — a slug can never begin `next` or `v0.4` and
 * shadow a version segment in the URL, because those are not sections.
 *
 * Sections are a **content** taxonomy, deliberately not package names: packages get
 * renamed and split (`packages/README.md`), and a public URL should survive that.
 * Adding one is a considered edit, not a side effect of writing a doc.
 */
export const SECTIONS = [
  "getting-started",
  "people",
  "contacts",
  "reminders",
  "gifts",
  "sync",
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Consumer-facing documentation. See `src/lib/docs.ts` for how a file becomes one of
 * these — in short, by carrying a `slug`.
 */
const docs = defineCollection({
  loader: docsLoader(),
  schema: z.object({
    /** The public URL, `section/name`. Stable across moves; see `src/lib/docs.ts`. */
    slug: z
      .string()
      .regex(SLUG, "must be `section/name` in lowercase kebab-case")
      .superRefine((slug, ctx) => {
        const section = slug.split("/")[0]!;
        if ((SECTIONS as readonly string[]).includes(section)) return;
        ctx.addIssue({
          code: "custom",
          message:
            `"${section}" is not a section. Use one of: ${SECTIONS.join(", ")} — ` +
            "or add a new one to SECTIONS in src/content.config.ts, deliberately.",
        });
      }),
    title: z.string().min(1),
    /** The app version this describes, `major.minor`. */
    since: z.string().regex(/^\d+\.\d+$/, "must be `major.minor`, e.g. `0.4`"),
    description: z.string().optional(),
  }),
});

export const collections = { docs, legal };
