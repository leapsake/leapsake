import { setFlagOverrides } from "@leapsake/flags";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "./router";
import { CustodyBanner } from "./screens/CustodyBanner";
import { RecoveryGate } from "./screens/RecoveryGate";

// Seed the renderer's copy of @leapsake/flags from the snapshot the main process
// resolved (`window.flags`, delivered synchronously by the preload). The renderer
// is a separate bundle with its own module instance, so this is what lets a
// screen call `flag()` in the same idiom the main process and mobile use, rather
// than reading a `window` global at every gate. It must run before the first
// render, hence module scope here.
setFlagOverrides(window.flags);

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// The data router is built lazily once boot is "ready" (see Root): `createHashRouter`
// runs its initial loader eagerly, so creating it at module load would fire
// `views.entityList` before the main process registers its IPC during a recovery
// boot.
let appRouter: ReturnType<typeof createAppRouter> | undefined;

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
  // Which unlock doors this store has, so the gate offers the password when there
  // is one and the phrase alone when there isn't (encryption `model.md` §7.5).
  const [doors, setDoors] = useState({ password: false, phrase: true });
  // Why this device cannot prove its master key, when that is the case: the
  // Degraded state (custody slice 10). It rides along with "ready" rather than
  // being a phase of its own, because the app genuinely is ready — see
  // {@link CustodyBanner}.
  const [degraded, setDegraded] = useState<{ detail: string } | undefined>();

  useEffect(() => {
    const offNeeded = window.boot.onUnlockNeeded(({ error: err, doors: d }) => {
      setError(err);
      setDoors(d);
      setPhase("recovering");
    });
    const offReady = window.boot.onReady((payload) => {
      // Core is live — safe to build the router now (its eager initial loader
      // will hit a registered `views.entityList`).
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

  // The banner sits above the router, not inside a screen: the state is a property
  // of the device, so it must be true on every screen the user navigates to.
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
