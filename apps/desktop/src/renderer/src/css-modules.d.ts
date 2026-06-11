// Ambient (script, no imports) so `declare module` is a true global fallback:
// `import styles from "./X.module.css"` yields a class-name map.
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
