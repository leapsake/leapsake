import { UiProvider } from "@leapsake/ui/web";
import { Link, Outlet } from "react-router-dom";
import { SearchBar } from "./components/SearchBar";
import { DropImportProvider } from "./import/DropImportProvider";
import { desktopUiAdapter } from "./lib/ui-adapter";

/**
 * Root layout. A persistent global search bar sits at the top as shared app
 * chrome; the active route renders below it via `<Outlet />`. The top nav
 * switches between the top-level lists — Reminders (the home screen), the
 * combined People & Pets list, the Holidays catalog, and the Gifts idea list —
 * plus Settings, which isn't reachable from any entity. Within People & Pets,
 * deeper navigation is handled by that list and breadcrumbs.
 *
 * `DropImportProvider` wraps the whole layout so a contact file can be dropped to
 * import from any screen (desktop only); its drop hint and review modal render as
 * overlays above the active route.
 *
 * `UiProvider` sits outermost, handing `@leapsake/ui`'s presentational components
 * this client's navigation and form primitives. It wraps the layout rather than
 * the router so every routed screen is below it.
 */
export function App() {
  return (
    <UiProvider adapter={desktopUiAdapter}>
      <DropImportProvider>
        <header>
          <SearchBar />
          <nav>
            <Link to="/reminders">Reminders</Link>{" "}
            <Link to="/people">People &amp; Pets</Link>{" "}
            <Link to="/holidays">Holidays</Link> <Link to="/gifts">Gifts</Link>{" "}
            <Link to="/settings">Settings</Link>
          </nav>
        </header>
        <Outlet />
      </DropImportProvider>
    </UiProvider>
  );
}
