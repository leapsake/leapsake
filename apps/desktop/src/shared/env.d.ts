/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `"1"` turns the sync preview on in a build; dev always has it. */
  readonly VITE_SYNC?: string;
}
