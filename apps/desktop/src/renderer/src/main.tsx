import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// Reactive invalidation: when a background sync pull applies remote changes,
// re-run the active route's loaders in place so the visible screen reflects the
// peer's edits without a manual navigation. `revalidate()` keeps the old data on
// screen until the new resolves (no spinner/flicker); gating on `changed` avoids
// a pointless re-read on pure-push or no-op pulls. Wiring to the activity event
// (not a specific trigger) means a manual "Sync now" still revalidates too.
window.sync.onActivity((payload) => {
  if (payload.changed) void router.revalidate();
});

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
