import { z } from "zod";

/**
 * Gender as a plain, closed enum — no free text. Optional everywhere it appears
 * (a nullable column on People and Pets), so "unset" is the absence of a value
 * rather than a fourth enum member. Kept deliberately small: it exists to drive
 * gendered relationship labels (father/mother, son/daughter, …), not to model
 * identity exhaustively.
 */
export const genderSchema = z.enum(["male", "female", "nonbinary"]);

export type Gender = z.infer<typeof genderSchema>;

/** Display labels for each gender value. */
export const genderLabel: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Non-binary",
};
