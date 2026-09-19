// Ambient, like `css-modules.d.ts`: a PNG import is its bundled URL. Not
// `vite/client`, which also brings a browser `ImportMeta` this env lacks.
declare module "*.png" {
  const src: string;
  export default src;
}
