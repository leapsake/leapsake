import { z } from "zod";

/** Every religion a person can be stated to hold, broad rather than by
 *  denomination, including those no catalog holiday belongs to yet. */
export const RELIGIONS = [
  "bahai",
  "buddhist",
  "chinese-folk",
  "christian",
  "confucian",
  "druze",
  "hindu",
  "indigenous",
  "jain",
  "jewish",
  "muslim",
  "pagan",
  "rastafari",
  "shinto",
  "sikh",
  "spiritist",
  "taoist",
  "yazidi",
  "zoroastrian",
] as const;

export const religionSchema = z.enum(RELIGIONS);

export type Religion = z.infer<typeof religionSchema>;
