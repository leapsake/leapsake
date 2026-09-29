// Drops HTML comments from rendered Markdown; see the README's _Pages_.
// oxlint-disable-next-line leapsake/max-comment-width -- a type, not prose
/** @type {import("@astrojs/markdown-satteri").SatteriProcessorOptions["mdastPlugins"] extends
 *   readonly (infer E)[] ? E : never} */
export const stripHtmlComments = {
  name: "leapsake:strip-html-comments",
  html(node, ctx) {
    if (node.value.trimStart().startsWith("<!--")) ctx.removeNode(node);
  },
};
