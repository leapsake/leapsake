// Ambient (script, no imports) so `declare module` is a true global fallback, matching
// `css-modules.d.ts` next door: `import logo from "./assets/logo.png"` yields the URL Vite
// emits for the bundled file. Declared here rather than by referencing `vite/client`,
// which would also pull in that package's `ImportMeta` augmentation and its assumptions
// about a browser env this renderer does not entirely share.
declare module "*.png" {
  const src: string;
  export default src;
}
