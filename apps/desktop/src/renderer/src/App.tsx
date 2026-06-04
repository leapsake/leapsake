import { Outlet } from "react-router-dom";

/**
 * Root layout. Renders the active route via `<Outlet />`; shared app chrome
 * (global nav, etc.) can live here as the app grows. People and pets share a
 * single home screen, so navigation is handled by that list and breadcrumbs
 * rather than a top-level switcher.
 */
export function App() {
  return <Outlet />;
}
