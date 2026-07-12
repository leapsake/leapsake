import { Link, Outlet } from "react-router-dom";
import { SearchBar } from "./components/SearchBar";

/**
 * Root layout. A persistent global search bar sits at the top as shared app
 * chrome; the active route renders below it via `<Outlet />`. People and pets
 * share a single home screen, so navigation is handled by that list and
 * breadcrumbs rather than a top-level switcher — the one exception is the
 * Settings link, since that screen isn't reachable from any entity.
 */
export function App() {
  return (
    <>
      <header>
        <SearchBar />
        <nav>
          <Link to="/reminders">Reminders</Link>{" "}
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
