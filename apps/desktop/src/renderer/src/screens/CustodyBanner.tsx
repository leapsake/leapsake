import { useState } from "react";

/**
 * The Degraded notice: a banner, not a gate, since the data is readable. The
 * way out is signing out to the unlock gate and using the other door.
 */
export function CustodyBanner({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function signOut() {
    setSignOutError(null);
    // Not awaited: it resolves only after the user passes the gate.
    void window.account.signOut().catch((cause: unknown) => {
      // Refused without a password door; the answer then is Forget account.
      setSignOutError(cause instanceof Error ? cause.message : String(cause));
    });
  }

  return (
    <aside
      role="status"
      style={{
        background: "#fff4e5",
        borderBottom: "1px solid #e0b070",
        padding: "0.75rem 1rem",
      }}
    >
      <strong>⚠ This device needs to be re-linked to your account.</strong>{" "}
      <span>
        Your data is safe and still here. Nothing is lost — but until you
        re-link it, this device can't confirm that it holds your account's key.
      </span>{" "}
      <button type="button" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide details" : "How to fix this"}
      </button>
      {expanded && (
        <div style={{ marginTop: "0.5rem" }}>
          <p>
            Sign out and unlock this device again. If you got here after
            entering your password, use your 24-word recovery phrase this time —
            and if you used the phrase, use your password.
          </p>
          <p style={{ color: "#6b5330" }}>{detail}</p>
          <p>
            <button type="button" onClick={signOut}>
              Sign out and unlock
            </button>
          </p>
          {signOutError !== null && (
            <p role="alert" style={{ color: "crimson" }}>
              {signOutError}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
