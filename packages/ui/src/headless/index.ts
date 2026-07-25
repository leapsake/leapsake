/**
 * `@leapsake/ui/headless` — behavior without markup.
 *
 * Hooks here return state and handlers and touch no DOM, so they are shared by
 * the web components in `../web` and are consumable by a React Native renderer
 * if one is ever added. Anything that renders an element belongs in `../web`.
 */
export {
  entityBasePath,
  neighborKey,
  neighborPath,
  relationshipEditPath,
  relationshipRemovePath,
} from "./routes.js";
export { useDebouncedSearch } from "./useDebouncedSearch.js";
export { useTypeahead } from "./useTypeahead.js";
