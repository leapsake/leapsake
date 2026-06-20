import type { SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Mirror of the main process's `MIN_PASSWORD_LENGTH` boundary check — keep the
 * two in step. This password derives the encryption key for a zero-knowledge
 * store with no server-side reset, so the floor is deliberately higher than a
 * typical login (see security-review.md).
 */
const MIN_PASSWORD_LENGTH = 12;

/** Prefilled relay origin for local development (apps/server defaults to :4000). */
const DEFAULT_RELAY_URL = "http://localhost:4000";

/**
 * A humble, dependency-free password hint. It does not pretend to score entropy
 * (no zxcvbn) — it enforces the length floor and steers toward a passphrase,
 * which is the guidance that actually helps for a key-deriving secret.
 */
function passwordHint(password: string): string {
  if (password === "") return "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Too short — use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!password.includes(" ") && password.length < 16) {
    return "A passphrase of 3–4 random words is stronger than a short complex password.";
  }
  return "Looks reasonable. Longer is stronger.";
}

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
        <AccountEnabled status={status} onCleared={refreshStatus} />
      ) : (
        <SyncSetup onEnabled={setRecoveryKey} onJoined={refreshStatus} />
      )}
    </main>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  onCleared,
}: {
  status: SyncStatus;
  onCleared: () => void;
}) {
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
      <hr />
      <DisconnectAccount onCleared={onCleared} />
    </>
  );
}

/**
 * Disconnect the account from this device. Two-step (a confirm) because it
 * revokes the password + recovery key for this account — though the local data
 * stays readable (the master key survives in the device enclave) and sync can be
 * set up again afterward.
 */
function DisconnectAccount({ onCleared }: { onCleared: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function disconnect() {
    setError(null);
    setWorking(true);
    try {
      await window.sync.clear();
      onCleared();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't disconnect.");
      setWorking(false);
    }
  }

  if (!confirming) {
    return (
      <p>
        <button type="button" onClick={() => setConfirming(true)}>
          Disconnect account from this device
        </button>
      </p>
    );
  }

  return (
    <>
      <p>
        Remove this account from this device? Your data stays on this device and
        you can set up sync again, but the current password and recovery key for
        this account will no longer work.
      </p>
      <p>
        <button type="button" onClick={disconnect} disabled={working}>
          {working ? "Disconnecting…" : "Yes, disconnect"}
        </button>{" "}
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={working}
        >
          Cancel
        </button>
      </p>
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}

/**
 * The combined sign-up / log-in flow (identity-first, like "continue with
 * email"). Step 1 takes a relay + username and asks the relay whether that
 * account exists (`window.sync.lookup`) — a miss routes to **create an account**,
 * a hit routes to **log in**. The existence probe is the same unauthenticated
 * prelogin a join already does, so it exposes nothing new; both branches then
 * require an explicit confirmation before the dangerous action runs.
 */
function SyncSetup({
  onEnabled,
  onJoined,
}: {
  onEnabled: (recoveryKey: string) => void;
  onJoined: () => void;
}) {
  const [username, setUsername] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [resolved, setResolved] = useState<{ exists: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContinue(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "") {
      setError("Username and relay URL are required.");
      return;
    }
    setChecking(true);
    try {
      setResolved(await window.sync.lookup({ username, relayUrl }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't reach the relay.",
      );
    } finally {
      setChecking(false);
    }
  }

  // Step 2: branch on whether the account already exists.
  if (resolved !== null) {
    const back = () => {
      setResolved(null);
      setError(null);
    };
    return resolved.exists ? (
      <LoginStep
        username={username}
        relayUrl={relayUrl}
        onBack={back}
        onJoined={onJoined}
      />
    ) : (
      <SignupStep
        username={username}
        relayUrl={relayUrl}
        onBack={back}
        onEnabled={onEnabled}
      />
    );
  }

  // Step 1: identity.
  return (
    <>
      <h3>Set up or log in to sync</h3>
      <p>
        Enter a username and relay. We'll check whether that account exists,
        then help you create it or log in.
      </p>
      <form onSubmit={onContinue}>
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
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={checking}>
          {checking ? "Checking…" : "Continue"}
        </button>
      </form>
    </>
  );
}

/**
 * Create-account branch: the username is free on the relay. Collect a password
 * (with confirmation), then require an explicit confirm before creating the
 * account — after which the parent reveals the one-time recovery key.
 */
function SignupStep({
  username,
  relayUrl,
  onBack,
  onEnabled,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onEnabled: (recoveryKey: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function onSubmit(event: React.FormEvent) {
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
    setConfirming(true);
  }

  async function create() {
    setError(null);
    setWorking(true);
    try {
      const { recoveryKey } = await window.sync.enable({
        username,
        password,
        relayUrl,
      });
      onEnabled(recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't create the account.",
      );
      setWorking(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <>
        <h3>Create this account?</h3>
        <p>
          This creates a new account <strong>{username}</strong> on {relayUrl}.
          You'll be shown a one-time recovery key to save.
        </p>
        <p>
          <button type="button" onClick={create} disabled={working}>
            {working ? "Creating…" : "Create account"}
          </button>{" "}
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={working}
          >
            Cancel
          </button>
        </p>
        {error !== null && <p role="alert">{error}</p>}
      </>
    );
  }

  const hint = passwordHint(password);

  return (
    <>
      <h3>Create account “{username}”</h3>
      <p>
        No account named <strong>{username}</strong> exists on {relayUrl}.
        Choose a password to create one and sync across devices.
      </p>
      <p>
        <strong>There is no password reset.</strong> Leapsake can't see your
        password, so if you forget it and have no other signed-in device, only
        your recovery key can recover your data. You'll be shown that key next —
        save it.
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
          {hint !== "" && (
            <>
              <br />
              <small>{hint}</small>
            </>
          )}
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
        <button type="submit">Continue</button>{" "}
        <button type="button" onClick={onBack}>
          Back
        </button>
      </form>
    </>
  );
}

/**
 * Log-in branch: the account exists. Collect the password, then require an
 * explicit confirm before joining. Because joining **replaces** this device's
 * data with the account's (the overwrite stance, multi-device-login.md), the
 * confirmation checks whether this device actually has local data and warns in
 * the strongest terms only when there is something to lose.
 */
function LoginStep({
  username,
  relayUrl,
  onBack,
  onJoined,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onJoined: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [hasLocalData, setHasLocalData] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password === "") {
      setError("Password is required.");
      return;
    }
    // Find out whether logging in would discard anything on this device, so the
    // confirmation can be honest. Treat a read failure as "might have data".
    setHasLocalData(null);
    void window.api.views
      .entityList()
      .then((rows) => setHasLocalData(rows.length > 0))
      .catch(() => setHasLocalData(true));
    setConfirming(true);
  }

  async function login() {
    setError(null);
    setWorking(true);
    try {
      await window.sync.join({ username, password, relayUrl });
      onJoined();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't log in.");
      setWorking(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <>
        <h3>Log in as “{username}”?</h3>
        {hasLocalData === null ? (
          <p>Checking this device…</p>
        ) : hasLocalData ? (
          <p role="alert">
            <strong>This device already has data.</strong> Logging in to{" "}
            <strong>{username}</strong> will replace it with the account's data.
            This can't be undone.
          </p>
        ) : (
          <p>
            Log in to <strong>{username}</strong> on {relayUrl} and sync this
            device.
          </p>
        )}
        <p>
          <button
            type="button"
            onClick={login}
            disabled={working || hasLocalData === null}
          >
            {working
              ? "Logging in…"
              : hasLocalData
                ? "Log in and replace data"
                : "Log in"}
          </button>{" "}
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={working}
          >
            Cancel
          </button>
        </p>
        {error !== null && <p role="alert">{error}</p>}
      </>
    );
  }

  return (
    <>
      <h3>Log in as “{username}”</h3>
      <p>
        Account <strong>{username}</strong> exists on {relayUrl}. Enter its
        password to log in and sync this device.
      </p>
      <form onSubmit={onSubmit}>
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
        <button type="submit">Continue</button>{" "}
        <button type="button" onClick={onBack}>
          Back
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
