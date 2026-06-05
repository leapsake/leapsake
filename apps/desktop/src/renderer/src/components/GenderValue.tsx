import { type Gender, genderLabel } from "@leapsake/schema";

/** A gender read from the kinship engine: the value plus how it was determined. */
export interface GenderResult {
  value: Gender | null;
  origin: "explicit" | "derived";
}

/**
 * Render a person's or pet's gender on the view page. The value displays plainly
 * whether it was set explicitly or inferred by the engine — the explicit/derived
 * distinction is a backend detail and stays out of the UI. An unknown gender
 * renders as a dash.
 */
export function GenderValue({ gender }: { gender: GenderResult }) {
  if (gender.value === null) return <>—</>;
  return <>{genderLabel[gender.value]}</>;
}
