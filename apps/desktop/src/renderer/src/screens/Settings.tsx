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
  // How many possible duplicates the most recent join surfaced — a prompt to
  // review them (0 = nothing to review). Set when a join completes.
  const [reviewCount, setReviewCount] = useState(0);

  function refreshStatus() {
    void window.sync.status().then(setStatus);
  }

  function onJoined(duplicateCount: number) {
    setReviewCount(duplicateCount);
    refreshStatus();
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
        <AccountEnabled
          status={status}
          reviewCount={reviewCount}
          onReviewed={() => setReviewCount(0)}
          onCleared={refreshStatus}
        />
      ) : (
        <SyncSetup onEnabled={setRecoveryKey} onJoined={onJoined} />
      )}

      <hr />
      <RecoveryPhraseSection />
    </main>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  reviewCount,
  onReviewed,
  onCleared,
}: {
  status: SyncStatus;
  reviewCount: number;
  onReviewed: () => void;
  onCleared: () => void;
}) {
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // The per-client "Sync automatically" preference (default on). Null until loaded.
  const [autoSync, setAutoSync] = useState<boolean | null>(null);

  // Background syncs (interval / window focus / after a local write) complete out
  // of band, so subscribe to keep the "last synced" line and error current even
  // when the user didn't press the button.
  useEffect(
    () =>
      window.sync.onActivity((payload) => {
        if (payload.at !== undefined) {
          setLastSynced(payload.at);
          setError(null);
        }
        if (payload.error !== undefined) setError(payload.error);
      }),
    [],
  );

  // Load the current "Sync automatically" preference once.
  useEffect(() => {
    void window.sync.getAutoSync().then(setAutoSync);
  }, []);

  async function toggleAutoSync(next: boolean) {
    setAutoSync(next); // optimistic; the IPC call is the source of truth
    await window.sync.setAutoSync(next);
  }

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
      {reviewCount > 0 && (
        <p role="status">
          Logging in found <strong>{reviewCount}</strong> possible{" "}
          {reviewCount === 1 ? "duplicate" : "duplicates"} between this device
          and your account.{" "}
          <Link to="/duplicates" onClick={onReviewed}>
            Review duplicates
          </Link>
        </p>
      )}
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
      {status.relayUrl !== undefined && autoSync !== null && (
        <p>
          <label>
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(event) => void toggleAutoSync(event.target.checked)}
            />{" "}
            Sync automatically
          </label>
          {!autoSync && (
            <>
              {" "}
              <small>
                Changes sync only when you press “Sync now” on this device.
              </small>
            </>
          )}
        </p>
      )}
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
  onJoined: (duplicateCount: number) => void;
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
  onJoined: (duplicateCount: number) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [hasLocalData, setHasLocalData] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [recovering, setRecovering] = useState(false);

  if (recovering) {
    return (
      <RecoverStep
        username={username}
        relayUrl={relayUrl}
        onBack={() => setRecovering(false)}
        onJoined={onJoined}
      />
    );
  }

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
      const { duplicateCount } = await window.sync.join({
        username,
        password,
        relayUrl,
      });
      onJoined(duplicateCount);
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
          <p>
            <strong>This device already has data.</strong> Logging in to{" "}
            <strong>{username}</strong> keeps it and combines it with the
            account's data; any people that look like duplicates are flagged for
            you to review and merge.
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
            {working ? "Logging in…" : "Log in"}
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
      <p>
        <button type="button" onClick={() => setRecovering(true)}>
          Forgot your password? Recover with your recovery phrase
        </button>
      </p>
    </>
  );
}

/**
 * Forgot-password recovery branch (model.md §6): the account exists but the user
 * lost the password. They enter their recovery phrase and choose a new password;
 * the master key is recovered from the relay's escrow and the password reset.
 */
function RecoverStep({
  username,
  relayUrl,
  onBack,
  onJoined,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onJoined: (duplicateCount: number) => void;
}) {
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (recoveryPhrase.trim() === "") {
      setError("Enter your recovery phrase.");
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
    setWorking(true);
    try {
      const { duplicateCount } = await window.sync.recover({
        username,
        recoveryPhrase,
        newPassword: password,
        relayUrl,
      });
      onJoined(duplicateCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't recover.");
      setWorking(false);
    }
  }

  return (
    <>
      <h3>Recover “{username}”</h3>
      <p>
        Enter your recovery phrase to recover <strong>{username}</strong> on{" "}
        {relayUrl} and choose a new password. Your old password can't be
        recovered — this replaces it.
      </p>
      <form onSubmit={onSubmit}>
        <p>
          <label>
            Recovery phrase
            <br />
            <textarea
              value={recoveryPhrase}
              rows={3}
              style={{ width: "100%", fontFamily: "monospace" }}
              onChange={(e) => setRecoveryPhrase(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            New password
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
            Confirm new password
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
        <button type="submit" disabled={working}>
          {working ? "Recovering…" : "Recover"}
        </button>{" "}
        <button type="button" onClick={onBack} disabled={working}>
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
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <main>
      <h1>Save your recovery phrase</h1>
      <p>
        This is shown <strong>once</strong>. Write it down or store it in a
        password manager. It's the only way back into your data if you lose your
        password — if you lose both, your data cannot be recovered.
      </p>
      <RecoveryPhraseWords phrase={recoveryKey} />
      <p>
        <label>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />{" "}
          I've saved my recovery phrase
        </label>
      </p>
      <button type="button" disabled={!acknowledged} onClick={onDone}>
        Done
      </button>
    </main>
  );
}

/** The numbered word grid + a copy button — shared by the one-time reveal and
 *  the on-demand "Reveal recovery phrase" in Settings. */
function RecoveryPhraseWords({ phrase }: { phrase: string }) {
  const [copied, setCopied] = useState(false);
  const words = phrase.split(" ");

  async function copy() {
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
  }

  return (
    <>
      <ol
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.25rem 1rem",
          padding: "0.75rem 0.75rem 0.75rem 2.5rem",
          margin: 0,
          fontFamily: "monospace",
          border: "1px solid currentColor",
          borderRadius: "0.25rem",
          userSelect: "all",
        }}
      >
        {words.map((word, i) => (
          <li key={`${i}-${word}`}>{word}</li>
        ))}
      </ol>
      <p>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>
    </>
  );
}

/**
 * On-demand recovery-phrase reveal, available whether or not sync is on (the
 * phrase also unlocks the local file if this device's key is ever lost —
 * `model.md` §6). Hidden behind a button so the words aren't shown unprompted.
 */
function RecoveryPhraseSection() {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setError(null);
    try {
      setPhrase(await window.sync.revealRecoveryPhrase());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't read the phrase.",
      );
    }
  }

  return (
    <>
      <h2>Recovery phrase</h2>
      <p>
        Your recovery phrase is the way back into your data if you lose your
        password or this device's secure storage is reset.
      </p>
      {phrase === null ? (
        <p>
          <button type="button" onClick={reveal}>
            Reveal recovery phrase
          </button>
        </p>
      ) : (
        <>
          <RecoveryPhraseWords phrase={phrase} />
          <p>
            <button type="button" onClick={() => setPhrase(null)}>
              Hide
            </button>
          </p>
        </>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}
