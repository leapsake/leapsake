/**
 * Drop HTML comments from rendered Markdown.
 *
 * Astro passes raw HTML in a Markdown file straight through to the output, and
 * `PRIVACY.md` opens with a comment block of internal notes — how each claim was
 * verified, and a `plans/` cross-reference. That is working material for whoever
 * edits the policy, and it must not reach the published page. Verified rather than
 * assumed: without this plugin the built page carries the whole block, the
 * `plans/v0-1.md` link included.
 *
 * Stripping is the mechanism; `test/privacy.test.ts` is the guarantee. It asserts
 * the built page contains no comment at all, so this failing silently — or being
 * dropped from the config — fails a test rather than leaking on the next deploy.
 *
 * A Sätteri mdast plugin rather than a remark one: Sätteri is Astro's default
 * Markdown processor as of Astro 7, and `markdown.remarkPlugins` now requires
 * installing `@astrojs/markdown-remark` to put the legacy `unified` pipeline back.
 * Reaching for the default processor's own hook costs one visitor and no detour.
 *
 * Declared as a plain object rather than through `defineMdastPlugin`, which is only
 * an identity function for type inference and would mean depending on `satteri`
 * itself as well.
 *
 * @type {import("@astrojs/markdown-satteri").SatteriProcessorOptions["mdastPlugins"] extends
 *   readonly (infer E)[] ? E : never}
 */
export const stripHtmlComments = {
  name: "leapsake:strip-html-comments",
  html(node, ctx) {
    if (node.value.trimStart().startsWith("<!--")) ctx.removeNode(node);
  },
};
