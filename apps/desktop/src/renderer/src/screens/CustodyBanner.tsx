import { useState } from "react";

/**
 * The **Degraded** state's standing notice (encryption `model.md` §7.5): this
 * device's store opened and every screen works, but the device cannot prove which
 * master key belongs to the account until that is repaired.
 *
 * It is a banner rather than a gate on purpose. The cause is invisible to the person
 * it happens to — an OS reinstall, a restored machine, a changed signing identity —
 * and their data is sitting readable on their own disk, so refusing to open the app
 * (which is what slice 9 did) punishes them for a problem they did not cause and
 * cannot see. What they *do* need is to know sync has stopped, since a silent
 * one-device island is the failure that costs them work.
 *
 * **The way out is the unlock gate.** Signing out drops the boot path into that
 * gate, where the *other* door is one click away — a phrase door is untouched by a
 * broken password door and vice versa — and the next open re-runs the repair with
 * it. That is why the CTA is sign-out and not a bespoke prompt: the gate, the doors,
 * and the repair all already exist and are proven.
 */
export function CustodyBanner({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function signOut() {
    setSignOutError(null);
    // Resolves only *after* the user unlocks (the re-open parks in the gate), so
    // nothing awaits it here — the gate takes over the window either way.
    void window.account.signOut().catch((cause: unknown) => {
      // The one refusal that matters: a device with no password door would be
      // locked behind the phrase alone, so sign out declines. Show it, because the
      // honest answer then is Forget account in Settings.
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
