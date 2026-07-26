import { MessagesProvider, en } from "@leapsake/ui/messages";
import {
  DropImportProvider,
  GiftsPortsProvider,
  SearchBar,
  UiProvider,
} from "@leapsake/ui/web";
import { Link, Outlet, useNavigate, useRevalidator } from "react-router-dom";
import { desktopGiftsPorts } from "./lib/gifts-ports";
import { searchEntities } from "./lib/search";
import { commitImport, previewImport } from "./lib/import-ports";
import { desktopUiAdapter } from "./lib/ui-adapter";

/**
 * Root layout. A persistent global search bar sits at the top as shared app
 * chrome; the active route renders below it via `<Outlet />`. The top nav
 * switches between the top-level lists — Reminders (the home screen), the
 * combined People & Pets list, the Holidays catalog, and the Gifts idea list —
 * plus Settings, which isn't reachable from any entity. Within People & Pets,
 * deeper navigation is handled by that list and breadcrumbs.
 *
 * Four providers wrap the layout, so every routed screen is below them:
 * `MessagesProvider` supplies the text `@leapsake/ui` renders (English today —
 * an i18n library replaces the catalog, not the components), `UiProvider` this
 * client's navigation and form primitives, `GiftsPortsProvider` the gift reads
 * and writes, and `DropImportProvider` the window-wide drop target whose hint and
 * review modal render as overlays above the active route.
 */
export function App() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return (
    <MessagesProvider messages={en}>
      <UiProvider adapter={desktopUiAdapter}>
        <GiftsPortsProvider ports={desktopGiftsPorts}>
          <DropImportProvider
            onPreview={previewImport}
            onCommit={commitImport}
            onDone={(outcome) => {
              // Reflect the new people wherever the user is; then land on the
              // list — or on the duplicate review, when the import left pairs
              // behind. The per-row flags only score each incoming contact
              // against people who already existed, so two contacts *within* one
              // import that duplicate each other are invisible to that pass, as
              // is a match the user chose to import anyway.
              revalidator.revalidate();
              if (outcome.created === 0) {
                navigate("/people");
                return;
              }
              void window.api.duplicates
                .count()
                .catch(() => 0)
                .then((outstanding) =>
                  navigate(outstanding > 0 ? "/duplicates" : "/people"),
                );
            }}
            onPickSelf={() => {
              revalidator.revalidate();
              navigate("/people?pick=self");
            }}
          >
            <header>
              <SearchBar search={searchEntities} onNavigate={navigate} />
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
