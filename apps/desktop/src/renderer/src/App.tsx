import { MessagesProvider, en } from "@leapsake/ui/messages";
import { GiftsPortsProvider, UiProvider } from "@leapsake/ui/web";
import { Link, Outlet } from "react-router-dom";
import { SearchBar } from "./components/SearchBar";
import { DropImportProvider } from "./import/DropImportProvider";
import { desktopGiftsPorts } from "./lib/gifts-ports";
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
 * Three providers wrap the layout, so every routed screen is below them:
 * `MessagesProvider` supplies the text `@leapsake/ui` renders (English today —
 * an i18n library replaces the catalog, not the components), `UiProvider` this
 * client's navigation and form primitives, and `GiftsPortsProvider` the gift
 * reads and writes.
 */
export function App() {
  return (
    <MessagesProvider messages={en}>
      <UiProvider adapter={desktopUiAdapter}>
        <GiftsPortsProvider ports={desktopGiftsPorts}>
          <DropImportProvider>
            <header>
              <SearchBar />
              <nav>
                <Link to="/reminders">Reminders</Link>{" "}
                <Link to="/people">People &amp; Pets</Link>{" "}
                <Link to="/holidays">Holidays</Link>{" "}
                <Link to="/gifts">Gifts</Link>{" "}
                <Link to="/settings">Settings</Link>
              </nav>
            </header>
            <Outlet />
          </DropImportProvider>
        </GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>
  );
}
