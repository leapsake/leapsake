export {
  personSchema,
  createPersonInputSchema,
  updatePersonInputSchema,
} from "./person.js";
export type { Person, CreatePersonInput, UpdatePersonInput } from "./person.js";
export { tagSchema, normalizeTagName, parseTagNames } from "./tag.js";
export type { Tag } from "./tag.js";
