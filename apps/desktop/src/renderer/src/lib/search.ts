import type { SearchHit } from "@leapsake/schema";

/** Module-level: `useDebouncedSearch` takes it as an effect dependency. */
export const searchEntities = (query: string): Promise<SearchHit[]> =>
  window.api.search.query(query);
