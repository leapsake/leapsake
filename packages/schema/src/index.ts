export {
  personSchema,
  createPersonInputSchema,
  updatePersonInputSchema,
} from "./person.js";
export type { Person, CreatePersonInput, UpdatePersonInput } from "./person.js";
export {
  petSchema,
  createPetInputSchema,
  updatePetInputSchema,
} from "./pet.js";
export type { Pet, CreatePetInput, UpdatePetInput } from "./pet.js";
export { tagSchema, normalizeTagName, parseTagNames } from "./tag.js";
export type { Tag } from "./tag.js";
export {
  entityTypeSchema,
  relationshipRoleSchema,
  relationshipSchema,
  createRelationshipInputSchema,
  updateRelationshipInputSchema,
  roleDefs,
  getRoleDef,
  inverseRole,
  holderAllows,
  rolesForHolder,
} from "./relationship.js";
export type {
  EntityType,
  RelationshipRole,
  RoleDef,
  Relationship,
  CreateRelationshipInput,
  UpdateRelationshipInput,
  RelationshipNeighbor,
} from "./relationship.js";
