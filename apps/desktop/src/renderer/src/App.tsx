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
import logo from "./assets/logo.png";
import styles from "./App.module.css";

/** Not drawn: the header's mark is labelled with it. */
const APP_NAME = "Leapsake";

/**
 * Root layout: search and the top nav above the active route, inside the
 * providers every screen needs (messages, UI adapter, gifts, drop import).
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
              // Ask for pairs afresh: the per-row flags miss duplicates within
              // one import, and matches the user chose to import anyway.
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
              {/* The mark is the only thing naming the app, so it keeps its alt
                  text; not an <h1>, since every screen supplies its own. */}
              <div className={styles.bar}>
                <img className={styles.mark} src={logo} alt={APP_NAME} />
                <div className={styles.search}>
                  <SearchBar search={searchEntities} onNavigate={navigate} />
                </div>
              </div>
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
