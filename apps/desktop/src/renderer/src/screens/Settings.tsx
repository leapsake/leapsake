import type { SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Mirror of the main process's `MIN_PASSWORD_LENGTH` boundary check. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Account & sync setup (custody Phase 1). Deliberately a *stateful* screen, not
 * a router loader/action: the recovery key is shown exactly once and must not
 * survive a navigation or a loader re-run, so it lives in local state and is
 * dropped the moment the user confirms they've saved it.
 *
 * There is no sync relay yet, so this only establishes the account — a portable
 * password unlock door plus the one-time recovery key. Actual device-to-device
 * sync arrives in a later slice; the copy says so rather than implying data
 * moves now.
 */
export function Settings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  useEffect(() => {
    void window.sync.status().then(setStatus);
  }, []);

  // One-time reveal takes over the screen until acknowledged.
  if (recoveryKey !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={recoveryKey}
        onDone={() => {
          setRecoveryKey(null);
          void window.sync.status().then(setStatus);
        }}
      />
    );
  }

  return (
    <main>
      <p>
        <Link to="/">&larr; Back</Link>
      </p>
      <h1>Settings</h1>
      <h2>Account &amp; sync</h2>

      {status === null ? (
        <p>Loading…</p>
      ) : status.enabled ? (
        <AccountEnabled status={status} />
      ) : (
        <EnableSyncForm onEnabled={setRecoveryKey} />
      )}
    </main>
  );
}

/** Shown once sync is enabled: the account exists; no re-enable is possible. */
function AccountEnabled({ status }: { status: SyncStatus }) {
  return (
    <>
      <p>Your account is set up.</p>
      <p>
        This device is protected by your password and recovery key. Account
        created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </p>
      <p>Device-to-device sync will arrive in a future update.</p>
    </>
  );
}

/**
 * Collect a password and enable sync. On success it hands the one-time recovery
 * key back to the parent (which switches to the reveal view); it never renders
 * the key itself.
 */
function EnableSyncForm({
  onEnabled,
}: {
  onEnabled: (recoveryKey: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { recoveryKey } = await window.sync.enable(password);
      onEnabled(recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't enable sync.",
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <p>
        Set a password to protect your account and prepare this device for sync.
        You'll be shown a one-time recovery key.
      </p>
      <form onSubmit={onSubmit}>
        <p>
          <label>
            Password
            <br />
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Confirm password
            <br />
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </p>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Setting up…" : "Set up account"}
        </button>
      </form>
    </>
  );
}

/**
 * The one-time recovery-key reveal. Irreversible: the key is never re-derivable,
 * so the user must copy it and tick the acknowledgement before continuing.
 */
function RecoveryKeyReveal({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
  }

  return (
    <main>
      <h1>Save your recovery key</h1>
      <p>
        This is shown <strong>once</strong>. Store it somewhere safe, like a
        password manager. If you lose both your password and this key, your data
        cannot be recovered.
      </p>
      <p>
        <code
          style={{
            display: "block",
            padding: "0.75rem",
            wordBreak: "break-all",
            userSelect: "all",
          }}
        >
          {recoveryKey}
        </code>
      </p>
      <p>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />{" "}
          I've saved my recovery key
        </label>
      </p>
      <button type="button" disabled={!acknowledged} onClick={onDone}>
        Done
      </button>
    </main>
  );
}
