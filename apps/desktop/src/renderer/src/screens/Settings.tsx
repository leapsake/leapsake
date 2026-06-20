import type { SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Mirror of the main process's `MIN_PASSWORD_LENGTH` boundary check. */
const MIN_PASSWORD_LENGTH = 8;

/** Prefilled relay origin for local development (apps/server defaults to :4000). */
const DEFAULT_RELAY_URL = "http://localhost:4000";

/**
 * Account & sync setup (custody Phase 1/2). Deliberately a *stateful* screen, not
 * a router loader/action: the recovery key is shown exactly once and must not
 * survive a navigation or a loader re-run, so it lives in local state and is
 * dropped the moment the user confirms they've saved it.
 *
 * Device-to-device sync is real now (multi-device-login.md Phase B): a first
 * device sets a password + username and registers with a relay; a second device
 * logs in to the same account; "Sync now" pushes/pulls the encrypted records.
 */
export function Settings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  function refreshStatus() {
    void window.sync.status().then(setStatus);
  }

  useEffect(refreshStatus, []);

  // One-time reveal takes over the screen until acknowledged.
  if (recoveryKey !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={recoveryKey}
        onDone={() => {
          setRecoveryKey(null);
          refreshStatus();
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
        <>
          <EnableSyncForm onEnabled={setRecoveryKey} />
          <hr />
          <JoinAccountForm onJoined={refreshStatus} />
        </>
      )}
    </main>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({ status }: { status: SyncStatus }) {
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const { at } = await window.sync.syncNow();
      setLastSynced(at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't sync.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <p>
        Your account is set up and protected by your password and recovery key.
      </p>
      <p>
        {status.username !== undefined && (
          <>
            Username <strong>{status.username}</strong>.{" "}
          </>
        )}
        {status.relayUrl !== undefined && <>Relay {status.relayUrl}. </>}
        Account created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </p>
      <p>
        <button type="button" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </p>
      {lastSynced !== null && (
        <p>Last synced {new Date(lastSynced).toLocaleTimeString()}.</p>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}

/**
 * Collect a username, password, and relay URL, and enable sync. On success it
 * hands the one-time recovery key back to the parent (which switches to the
 * reveal view); it never renders the key itself.
 */
function EnableSyncForm({
  onEnabled,
}: {
  onEnabled: (recoveryKey: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "") {
      setError("Username and relay URL are required.");
      return;
    }
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
      const { recoveryKey } = await window.sync.enable({
        username,
        password,
        relayUrl,
      });
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
      <h3>Set up a new account</h3>
      <p>
        Choose a username, password, and relay to protect your account and sync
        across devices. You'll be shown a one-time recovery key.
      </p>
      <form onSubmit={onSubmit}>
        <p>
          <label>
            Username
            <br />
            <input
              type="text"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Relay URL
            <br />
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
            />
          </label>
        </p>
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
 * Log in to an existing account from this (fresh) device. On success the parent
 * refreshes status, which flips the screen to the enabled view. This device's
 * prior local data is abandoned (overwrite is the accepted first-cut stance;
 * reconciliation is a documented future phase).
 */
function JoinAccountForm({ onJoined }: { onJoined: () => void }) {
  const [username, setUsername] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "" || password === "") {
      setError("Username, relay URL, and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await window.sync.join({ username, password, relayUrl });
      onJoined();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't log in.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <h3>Log in to an existing account</h3>
      <p>
        Already using Leapsake on another device? Log in to sync this device.
        Anything currently on this device will be replaced.
      </p>
      <form onSubmit={onSubmit}>
        <p>
          <label>
            Username
            <br />
            <input
              type="text"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Relay URL
            <br />
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Password
            <br />
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </p>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
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
