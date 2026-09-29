// Metro imports a `.png` as its numeric asset id. Declared here, not in the
// generated, gitignored `expo-env.d.ts`, so a fresh clone typechecks.
declare module "*.png" {
  const asset: number;
  export default asset;
}
