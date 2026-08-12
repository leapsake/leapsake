import type { GiftsPorts } from "@leapsake/ui/web";

/**
 * The gift ports for a server render: **every method throws**.
 *
 * A stub that returned `[]` would be a lie that renders. This one is an
 * assertion — nothing should invoke a port during render, because a port is a
 * read or a write the *loader* was supposed to have done, and a render that
 * reaches for one on the server has found a component doing data access in a
 * place SSR cannot follow. If any of these ever fires, that is a finding about
 * `@leapsake/ui`, not a stub to fill in.
 *
 * The provider still has to be mounted: `useGiftsPorts()` throws when no
 * `GiftsPortsProvider` is above it, and `GiftsSection` calls it unconditionally
 * during `PersonScreen`'s render. So the object must exist and its methods must
 * not run — which is exactly what a throwing implementation expresses.
 *
 * (Effects don't run during `renderToString`, so a component that loads through
 * `useEffect` is invisible here. That is a *limit of the assertion*, not a hole
 * in it: such a component is inert without JavaScript either way, and the no-JS
 * section inventory in the findings is where it gets counted.)
 */
function duringRender(port: string): never {
  throw new Error(
    `web-spike: gift port ${port}() was invoked during server render. ` +
      "Nothing should reach for a port while rendering — the loader owns reads " +
      "and a route action owns writes. See src/gifts-ports-ssr.ts.",
  );
}

export const ssrGiftsPorts: GiftsPorts = {
  loadOccasions: () => duringRender("loadOccasions"),
  loadGiven: () => duringRender("loadGiven"),
  loadOccurrences: () => duringRender("loadOccurrences"),
  capture: () => duringRender("capture"),
  createSuggestion: () => duringRender("createSuggestion"),
  updateSuggestion: () => duringRender("updateSuggestion"),
  removeSuggestion: () => duringRender("removeSuggestion"),
  updateGiving: () => duringRender("updateGiving"),
  removeGiving: () => duringRender("removeGiving"),
};
