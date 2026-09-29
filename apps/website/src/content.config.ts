import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

import { docsLoader } from "./lib/docs";

/** The legal documents, read from the repository root, never copied; `base`
 *  is relative to `apps/website`. */
const legal = defineCollection({
  loader: glob({ pattern: "PRIVACY.md", base: "../.." }),
});

/** Every section a doc's URL may start with: a closed content taxonomy, so no
 *  slug can shadow a version. See the README. */
export const SECTIONS = [
  "getting-started",
  "people",
  "contacts",
  "reminders",
  "gifts",
  "sync",
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Consumer-facing documentation: any markdown file carrying a `slug`. */
const docs = defineCollection({
  loader: docsLoader(),
  schema: z.object({
    /** The public URL, `section/name`, stable across moves. */
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
