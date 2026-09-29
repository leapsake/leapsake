// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";

import { stripHtmlComments } from "./src/lib/strip-comments.mjs";

export default defineConfig({
  site: "https://leapsake.com",

  markdown: {
    // Named, so it can take the plugin that keeps PRIVACY.md's HTML comment out
    // of the page; see the README's _Pages_.
    processor: satteri({ mdastPlugins: [stripHtmlComments] }),
  },

  vite: {
    ssr: {
      // `@leapsake/ui` exports raw `.ts`, which Vite must transpile.
      noExternal: ["@leapsake/ui"],
    },
  },
});
