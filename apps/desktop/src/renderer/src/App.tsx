import { Outlet } from "react-router-dom";
import { SearchBar } from "./components/SearchBar";

/**
 * Root layout. A persistent global search bar sits at the top as shared app
 * chrome; the active route renders below it via `<Outlet />`. People and pets
 * share a single home screen, so navigation is handled by that list and
 * breadcrumbs rather than a top-level switcher.
 */
export function App() {
  return (
    <>
      <header>
        <SearchBar />
      </header>
      <Outlet />
    </>
  );
}
