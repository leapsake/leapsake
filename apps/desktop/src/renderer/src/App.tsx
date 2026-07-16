import { Link, Outlet } from "react-router-dom";
import { SearchBar } from "./components/SearchBar";
import { DropImportProvider } from "./import/DropImportProvider";

/**
 * Root layout. A persistent global search bar sits at the top as shared app
 * chrome; the active route renders below it via `<Outlet />`. The top nav
 * switches between the two top-level lists — Reminders (the home screen) and the
 * combined People & Pets list — plus Settings, which isn't reachable from any
 * entity. Within People & Pets, deeper navigation is handled by that list and
 * breadcrumbs.
 *
 * `DropImportProvider` wraps the whole layout so a contact file can be dropped to
 * import from any screen (desktop only); its drop hint and review modal render as
 * overlays above the active route.
 */
export function App() {
  return (
    <DropImportProvider>
      <header>
        <SearchBar />
        <nav>
          <Link to="/reminders">Reminders</Link>{" "}
          <Link to="/people">People &amp; Pets</Link>{" "}
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <Outlet />
    </DropImportProvider>
  );
}
