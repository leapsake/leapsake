import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "./router";
import { CustodyBanner } from "./screens/CustodyBanner";
import { RecoveryGate } from "./screens/RecoveryGate";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// Built only once boot is ready: see `createAppRouter`.
let appRouter: ReturnType<typeof createAppRouter> | undefined;

// `revalidate()` keeps the old data on screen until the new resolves.
window.app.onChanged(() => {
  void appRouter?.revalidate();
});

/**
 * The boot gate: the unlock prompt while the store is locked, then the app once
 * the core is live. `status()` covers an event that fired before subscribing.
 */
function Root() {
  const [phase, setPhase] = useState<"starting" | "recovering" | "ready">(
    "starting",
  );
  const [error, setError] = useState<string | undefined>();
  const [doors, setDoors] = useState({ password: false, phrase: true });
  // Degraded rides along with "ready": the app genuinely is ready.
  const [degraded, setDegraded] = useState<{ detail: string } | undefined>();

  useEffect(() => {
    const offNeeded = window.boot.onUnlockNeeded(({ error: err, doors: d }) => {
      setError(err);
      setDoors(d);
      setPhase("recovering");
    });
    const offReady = window.boot.onReady((payload) => {
      appRouter ??= createAppRouter();
      setDegraded(payload.degraded);
      setPhase("ready");
    });
    void window.boot.status().then((s) => {
      if (s.phase === "ready") appRouter ??= createAppRouter();
      setPhase(s.phase);
      setError(s.error);
      setDoors(s.doors);
      setDegraded(s.degraded);
    });
    return () => {
      offNeeded();
      offReady();
    };
  }, []);

  // Above the router, so the device's state shows on every screen.
  if (phase === "ready" && appRouter !== undefined)
    return (
      <>
        {degraded !== undefined && <CustodyBanner detail={degraded.detail} />}
        <RouterProvider router={appRouter} />
      </>
    );
  if (phase === "recovering")
    return <RecoveryGate error={error} doors={doors} />;
  return null; // brief "starting" flash; the DB usually opens immediately
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
