// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";

import { stripHtmlComments } from "./src/lib/strip-comments.mjs";

export default defineConfig({
  site: "https://leapsake.com",

  markdown: {
    // `satteri()` is the default processor; naming it here is what lets the pipeline
    // be extended. See the plugin's own doc-comment — PRIVACY.md's internal notes are
    // an HTML comment, and Astro would otherwise ship them in the page source.
    processor: satteri({ mdastPlugins: [stripHtmlComments] }),
  },

  vite: {
    ssr: {
      // `@leapsake/ui` exports raw `.ts` source rather than a build (its exports map
      // points straight at `src/`), so Vite has to transpile it instead of treating
      // it as an external dependency. Without this the build dies on an unparsed
      // TypeScript import the moment anything reads the tokens.
      noExternal: ["@leapsake/ui"],
    },
  },
});
