import { Outlet } from "react-router-dom";

/**
 * Root layout. Renders the active route via `<Outlet />`; shared app chrome
 * (global nav, etc.) can live here as the app grows.
 */
export function App() {
  return <Outlet />;
}
