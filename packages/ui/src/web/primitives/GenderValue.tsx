import type { Gender } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/** A gender from the kinship engine, and how it was determined. */
export interface GenderResult {
  value: Gender | null;
  origin: "explicit" | "derived";
}

/** A gender as shown, set or inferred alike; unknown is a dash. */
export function GenderValue({ gender }: { gender: GenderResult }) {
  const m = useMessages();
  if (gender.value === null) return <>{m.common.none}</>;
  return <>{m.gender[gender.value]}</>;
}
