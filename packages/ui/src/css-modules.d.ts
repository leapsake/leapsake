// Ambient, so any `*.module.css` import types as a class-name map; each
// consuming bundler resolves the stylesheet itself.
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
