import type { SearchHit } from "@leapsake/schema";

/**
 * The renderer's entity search, as a stable module-level function.
 *
 * Identity matters: `useDebouncedSearch` takes it as an effect dependency, so an
 * inline arrow would re-run the search on every render of whatever holds it.
 */
export const searchEntities = (query: string): Promise<SearchHit[]> =>
  window.api.search.query(query);
