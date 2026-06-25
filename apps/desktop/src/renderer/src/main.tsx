import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "./router";
import { RecoveryGate } from "./screens/RecoveryGate";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// The data router is built lazily once boot is "ready" (see Root): `createHashRouter`
// runs its initial loader eagerly, so creating it at module load would fire
// `views.entityList` before the main process registers its IPC during a recovery
// boot. We hold the instance here so the sync-activity subscription can revalidate
// it once it exists (and harmlessly no-op before then).
let appRouter: ReturnType<typeof createAppRouter> | undefined;

// Reactive invalidation: when a background sync pull applies remote changes,
// re-run the active route's loaders in place so the visible screen reflects the
// peer's edits without a manual navigation. `revalidate()` keeps the old data on
// screen until the new resolves (no spinner/flicker); gating on `changed` avoids
// a pointless re-read on pure-push or no-op pulls. Wiring to the activity event
// (not a specific trigger) means a manual "Sync now" still revalidates too.
window.sync.onActivity((payload) => {
  if (payload.changed) void appRouter?.revalidate();
});

/**
 * The boot gate: the renderer mounts before the database is open, so it watches
 * the main process's boot phase and renders the at-rest recovery prompt while the
 * enclave key is being recovered, swapping in the real app once the core is live.
 * `status()` is the race-safe initial read in case an event fired before we
 * subscribed (encryption `model.md` §6).
 */
function Root() {
  const [phase, setPhase] = useState<"starting" | "recovering" | "ready">(
    "starting",
  );
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const offNeeded = window.boot.onRecoveryNeeded((err) => {
      setError(err);
      setPhase("recovering");
    });
    const offReady = window.boot.onReady(() => {
      // Core is live — safe to build the router now (its eager initial loader
      // will hit a registered `views.entityList`).
      appRouter ??= createAppRouter();
      setPhase("ready");
    });
    void window.boot.status().then((s) => {
      if (s.phase === "ready") appRouter ??= createAppRouter();
      setPhase(s.phase);
      setError(s.error);
    });
    return () => {
      offNeeded();
      offReady();
    };
  }, []);

  if (phase === "ready" && appRouter !== undefined)
    return <RouterProvider router={appRouter} />;
  if (phase === "recovering") return <RecoveryGate error={error} />;
  return null; // brief "starting" flash; the DB usually opens immediately
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
