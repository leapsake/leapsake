// Ambient (script, no imports) so `declare module` is a true global fallback:
// `import styles from "./X.module.css"` yields a class-name map. The package
// ships raw source, so each consuming bundler resolves the stylesheet itself;
// this only teaches tsc what the import evaluates to.
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
