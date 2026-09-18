import { z } from "zod";

/**
 * The genders that pick a gendered role label; unset is null, not a member.
 * It drives labels only and does not model identity.
 */
export const genderSchema = z.enum(["male", "female", "nonbinary"]);

export type Gender = z.infer<typeof genderSchema>;

/** Display labels for each gender value. */
export const genderLabel: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Non-binary",
};
