import { MIN_PASSWORD_LENGTH, type SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Prefilled relay origin for local development (apps/server defaults to :4000). */
const DEFAULT_RELAY_URL = "http://localhost:4000";

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

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
  // The phrase currently on screen for its one-and-only showing — from account
  // creation, or from the rotation that replaced it. `escrowPending` is only ever
  // true for the latter (see {@link RecoveryPhraseSection}).
  const [revealed, setRevealed] = useState<{
    phrase: string;
    escrowPending: boolean;
  } | null>(null);
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

  // One-time reveal takes over the screen until acknowledged. The main process
  // has already re-opened the app around the converted store, so "Done" simply
  // drops the phrase and returns to Settings — now reporting the new account.
  if (revealed !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={revealed.phrase}
        escrowPending={revealed.escrowPending}
        onDone={() => {
          setRevealed(null);
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
        />
      ) : (
        <>
          <CreateAccount
            onCreated={(phrase) =>
              setRevealed({ phrase, escrowPending: false })
            }
          />
          <hr />
          <SyncSetup
            onEnabled={(phrase) =>
              setRevealed({ phrase, escrowPending: false })
            }
            onJoined={onJoined}
          />
        </>
      )}

      {/*
        The two ways to be rid of what is on this device, one per custody state
        (`model.md` §7.2). They are the *same act* wearing the name that fits:
        with an account, "Forget account" removes it and its store; without one
        there is no account to forget, so the accountless wipe is the only shape
        the action can take. Showing both at once was showing one act twice —
        they land in the identical place (an accountless device with a fresh
        empty store), and the differences that remain are invisible to a user.
      */}
      {status !== null &&
        (status.enabled ? (
          <>
            <hr />
            <RecoveryPhraseSection onRotated={setRevealed} />
            <hr />
            <SignOut />
            <hr />
            <ForgetAccount />
          </>
        ) : (
          <>
            <hr />
            <FactoryReset />
          </>
        ))}
    </main>
  );
}

/**
 * **Sign out** (`model.md` §7.3) — the one action that reaches the Locked state
 * in v0.1.
 *
 * Two things it is deliberately not. It is not a *Lock* button: Locked is a
 * state, not an affordance, and the app is meant to enter it on the user's behalf
 * once idle locking ships (v0.2). And it is not two behaviors wearing one name —
 * the promise is identical whether or not the account is relay-bound (*nobody can
 * see my data on this device anymore*), so the copy never branches on it. The one
 * difference, that the encrypted bytes remain, is stated plainly because it is the
 * part a local-only user would otherwise worry about.
 *
 * No confirmation step: it is reversible with the password, and gating it behind a
 * dialog would teach users to click through the confirmations that *do* matter.
 */
function SignOut() {
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    setError(null);
    // Deliberately not awaited. The main process raises the unlock gate as part
    // of this call and resolves only once the user has passed it, so awaiting
    // would leave a "Signing out…" button on a screen that has already been
    // replaced by the gate. A rejection still surfaces: it means the sign out was
    // refused up front, and this screen is still on top.
    window.sync.signOut().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Couldn't sign out.");
    });
  }

  return (
    <>
      <h2>Sign out</h2>
      <p>
        Your data stays on this device, encrypted. You’ll need your password to
        get back in.
      </p>
      <p>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </p>
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}

/** The word a user must type to arm the (irreversible) account deletion. */
const FORGET_ACCOUNT_PHRASE = "DELETE";

/**
 * **Forget account** (`model.md` §7.3) — remove this account and its data from
 * this device. Named as removal so it can never be mistaken for signing out.
 *
 * The wording is **driven by a check, not hardcoded** (§7.3.1). Forgetting an
 * account on its last remaining device is functionally a deletion unless a server
 * durably holds a copy, so the main process asks the relay and reports
 * `durableBackup`; absent an answer — today's universal case, since no relay
 * advertises the capability yet — it is `false` and this shows the alarming
 * version, hard-confirm and all. When server-side backup ships, the alarming copy
 * stops appearing on its own rather than having to be hunted down.
 */
function ForgetAccount() {
  const [info, setInfo] = useState<{
    username?: string;
    relayUrl?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Read on entering the confirmation rather than on mount: it reaches out to the
  // relay, and there is no reason to do that for every visit to Settings.
  function beginConfirm() {
    setError(null);
    window.sync
      .forgetInfo()
      .then(setInfo)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't check this account.",
        );
      });
  }

  function cancel() {
    setInfo(null);
    setTyped("");
    setError(null);
  }

  // A relay that keeps a durable copy makes this ordinary — sign back in and
  // re-pull. Without one, the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await window.sync.forgetAccount();
      // Unreachable in practice: the renderer is reloaded before this resolves.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove it.");
      setWorking(false);
    }
  }

  if (info === null) {
    return (
      <>
        <h2>Forget account</h2>
        <p>
          Remove this account and everything in it from this device. This is not
          signing out — the data is deleted, not locked.
        </p>
        <p>
          <button type="button" onClick={beginConfirm}>
            Forget account…
          </button>
        </p>
        {error !== null && <p role="alert">{error}</p>}
      </>
    );
  }

  return (
    <>
      <h2>{lastCopy ? "Delete all data on this device" : "Forget account"}</h2>
      {lastCopy ? (
        <>
          <p>
            <strong>
              This permanently deletes everything in{" "}
              {info.username !== undefined ? (
                <>the account “{info.username}”</>
              ) : (
                "this account"
              )}{" "}
              on this device.
            </strong>{" "}
            {info.relayUrl === undefined
              ? "This account is only on this device, so there is no other copy."
              : `${info.relayUrl} does not keep a backup of your data, so if this is your only device there is no other copy.`}
          </p>
          <p>
            If you might want this data later, close this and copy your{" "}
            <code>stores</code> folder somewhere safe first — Leapsake cannot
            export it yet.
          </p>
          <p>
            Type <strong>{FORGET_ACCOUNT_PHRASE}</strong> to confirm.
          </p>
        </>
      ) : (
        <p>
          Remove{" "}
          {info.username !== undefined ? `“${info.username}”` : "this account"}{" "}
          from this device? {info.relayUrl} keeps a copy of your data, so you
          can sign back in on this or another device to get it again.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void forget();
        }}
      >
        {lastCopy && (
          <p>
            <label>
              Confirmation
              <br />
              <input
                type="text"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
          </p>
        )}
        <p>
          <button type="submit" disabled={!armed || working}>
            {working
              ? "Removing…"
              : lastCopy
                ? "Delete all data on this device"
                : "Forget account"}
          </button>{" "}
          <button type="button" onClick={cancel} disabled={working}>
            Cancel
          </button>
        </p>
      </form>
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  reviewCount,
  onReviewed,
}: {
  status: SyncStatus;
  reviewCount: number;
  onReviewed: () => void;
}) {
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Set when a sync 401s because the password was reset on another device — shows
  // the re-enter-password prompt below. Cleared on the next successful sync.
  const [needsReauth, setNeedsReauth] = useState(false);
  // The per-client "Sync automatically" preference (default on). Null until loaded.
  const [autoSync, setAutoSync] = useState<boolean | null>(null);
  // Whether this device is *Degraded* — it holds the account but cannot prove the
  // account's master key, so it syncs nothing (custody slice 10). The boot path is
  // the only thing that knows, hence `window.boot` rather than `window.sync`.
  const [degraded, setDegraded] = useState(false);

  // Background syncs (interval / window focus / after a local write) complete out
  // of band, so subscribe to keep the "last synced" line and error current even
  // when the user didn't press the button.
  useEffect(
    () =>
      window.sync.onActivity((payload) => {
        if (payload.at !== undefined) {
          setLastSynced(payload.at);
          setError(null);
          setNeedsReauth(false);
        }
        if (payload.error !== undefined) setError(payload.error);
        if (payload.needsReauth === true) setNeedsReauth(true);
      }),
    [],
  );

  // Load the current "Sync automatically" preference once.
  useEffect(() => {
    void window.sync.getAutoSync().then(setAutoSync);
    void window.boot
      .status()
      .then((s) => setDegraded(s.degraded !== undefined));
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
      const message = cause instanceof Error ? cause.message : "Couldn't sync.";
      // A 401 means the account password was reset on another device. The main
      // process broadcasts the re-auth prompt via sync:activity (the onActivity
      // effect above sets the friendly text); flip the prompt on and suppress the
      // raw "…failed: 401" so the friendly message wins instead of leaking.
      if (message.includes("401")) setNeedsReauth(true);
      else setError(message);
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
      {/*
        No relay means an account created locally (`CreateAccount` below), which
        has nothing to sync to. The controls are not shown rather than shown and
        failing: every one of them ended in "Sync is not enabled for this store."
      */}
      {status.relayUrl === undefined ? (
        <p>
          This account is on this computer only. Nothing is sent anywhere, so
          nothing here needs syncing.
        </p>
      ) : degraded ? (
        /*
          Degraded (custody slice 10): the controls are hidden for the same reason
          they are on a relay-less account — every one of them would fail, and
          pressing "Sync now" to be told why is a worse way to learn it. The banner
          at the top of the window carries the cause and the fix.
        */
        <p>
          Sync is paused until this device is re-linked to your account — see
          the notice at the top of the window.
        </p>
      ) : (
        <>
          {autoSync !== null && (
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(event) =>
                    void toggleAutoSync(event.target.checked)
                  }
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
        </>
      )}
      {error !== null && <p role="alert">{error}</p>}
      {needsReauth && (
        <ReconnectForm
          onReconnected={() => {
            setNeedsReauth(false);
            setError(null);
          }}
          onError={setError}
        />
      )}
    </>
  );
}

/**
 * Re-enter the (new) password to reconnect this device after the account password
 * was reset on another device. Re-derives this device's relay credential from the
 * password — the master key and local data are untouched — then resumes sync.
 */
function ReconnectForm({
  onReconnected,
  onError,
}: {
  onReconnected: () => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);

  async function reconnect() {
    if (password.length === 0) return;
    setWorking(true);
    try {
      await window.sync.reauthenticate(password);
      setPassword("");
      onReconnected();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't reconnect.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void reconnect();
      }}
    >
      <label>
        New password{" "}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>{" "}
      <button type="submit" disabled={working || password.length === 0}>
        {working ? "Reconnecting…" : "Reconnect"}
      </button>
    </form>
  );
}

/**
 * **Create an account on this device** (`model.md` §7.2.1) — the act that turns
 * encryption on. Entirely local: no relay, no email, nothing transmitted.
 *
 * The copy here is load-bearing, and the design is explicit about it in two ways:
 *
 * 1. **Promise access, not safety.** An account protects against *this device
 *    losing its security settings*; it does nothing about a lost or broken
 *    device. Borrowing the user's SaaS instincts and then violating them on the
 *    worst day is the failure mode to avoid, so backups are named here rather
 *    than implied.
 * 2. **"Account" is our vocabulary, not the user's.** A username and password
 *    that never leave the laptop are *accountless* in every sense a user cares
 *    about. The heading softens the word; the mechanism is unchanged.
 */
function CreateAccount({ onCreated }: { onCreated: (phrase: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (username.trim() === "") {
      setError("Choose a username.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { recoveryPhrase } = await window.sync.createAccount({
        username,
        password,
      });
      onCreated(recoveryPhrase);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't create the account.",
      );
      setBusy(false);
    }
  }

  return (
    <section>
      <h3>Protect your data</h3>
      <p>
        Right now anyone with access to this computer can read your Leapsake
        data. Setting up a username and password encrypts it on this device.
      </p>
      <p>
        This stays on this computer — there's no email, no server, and nothing
        is sent anywhere.{" "}
        <strong>It protects access to your data, not the data itself:</strong>{" "}
        if this computer is lost or breaks, a password won't bring your data
        back. Set up sync or keep a backup for that.
      </p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <p>
          <label>
            Username{" "}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
        </p>
        <p>
          <label>
            Password{" "}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        </p>
        <p>
          <label>
            Confirm password{" "}
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        </p>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Encrypting your data…" : "Protect my data"}
        </button>
      </form>
    </section>
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
 * The one-time recovery-key reveal. Irreversible: the phrase is shown **once** and
 * has no reveal-it-later surface, so the user must copy it and tick the
 * acknowledgement before continuing.
 *
 * Rendered as a fixed overlay rather than an ordinary screen so the app chrome
 * (nav, search) sits behind it and cannot be clicked. Settings renders inside the
 * router's `<Outlet />`, so without this a stray click on "Reminders" would
 * navigate away and take the only copy of the phrase with it.
 */
function RecoveryKeyReveal({
  recoveryKey,
  escrowPending,
  onDone,
}: {
  recoveryKey: string;
  /**
   * The rotation could not reach the relay, so the account's escrow still answers
   * to the *previous* phrase. Only ever true for a rotation — a new account has no
   * previous phrase, and a local-only account has no escrow.
   */
  escrowPending: boolean;
  onDone: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1,
        overflow: "auto",
        background: "Canvas",
        padding: "3rem 1rem",
      }}
    >
      <h1>Save your recovery phrase</h1>
      <p>
        This is shown <strong>once</strong>. Write it down or store it in a
        password manager. It's the only way back into your data if you lose your
        password — if you lose both, your data cannot be recovered.
      </p>
      <RecoveryPhraseWords phrase={recoveryKey} />
      {escrowPending && (
        <p role="alert">
          <strong>Keep your old phrase until this device next syncs.</strong>{" "}
          Leapsake couldn't reach your relay, so recovering your account on a
          new device still needs the <em>old</em> phrase. This one takes over
          automatically the next time this device syncs.
        </p>
      )}
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

/** The numbered word grid + a copy button — used by the one-time reveal, which
 *  since custody slice 8 is the *only* place a phrase is ever displayed (at
 *  account creation, and at the rotation that replaces it). */
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
 * Factory reset: erase everything on this device and reopen as a fresh install.
 *
 * **Shown only while this device is Open** (`model.md` §7.2) — with an account,
 * {@link ForgetAccount} is the same act under the name that fits, and offering
 * both was offering one act twice. That is also why this no longer branches its
 * copy on whether sync is set up: an Open device has no account, so the data
 * here is by definition the only copy, and "erase" means exactly what it says.
 *
 * Gated behind a type-to-confirm step (the button stays disabled until the user
 * types {@link FACTORY_RESET_PHRASE}) because nothing about it is recoverable.
 * The main process reopens the app around a fresh store and reloads this
 * renderer, so there is no completion state to render.
 */
function FactoryReset() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const armed = typed.trim().toUpperCase() === FACTORY_RESET_PHRASE;

  async function reset() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await window.sync.factoryReset();
      // Unreachable in practice: the renderer is reloaded before this resolves.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reset.");
      setWorking(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  if (!confirming) {
    return (
      <>
        <h2>Factory reset</h2>
        <p>
          Erase everything on this device and start over — all people, pets,
          reminders, and settings. The app starts as if newly installed.
        </p>
        <p>
          <button type="button" onClick={() => setConfirming(true)}>
            Factory reset…
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Factory reset</h2>
      <p>
        <strong>This permanently erases all data on this device.</strong> There
        is no account holding a copy, so this data cannot be recovered
        afterward.
      </p>
      <p>
        Type <strong>{FACTORY_RESET_PHRASE}</strong> to confirm.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void reset();
        }}
      >
        <p>
          <label>
            Confirmation
            <br />
            <input
              type="text"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        </p>
        <p>
          <button type="submit" disabled={!armed || working}>
            {working ? "Erasing…" : "Erase everything"}
          </button>{" "}
          <button type="button" onClick={cancel} disabled={working}>
            Cancel
          </button>
        </p>
        {error !== null && <p role="alert">{error}</p>}
      </form>
    </>
  );
}

/**
 * Replace the recovery phrase — **only rendered once an account exists**, and only
 * ever a *replacement*. It used to be a "Reveal recovery phrase" button; custody
 * slice 8 retired that (owner, 2026-07-28). The phrase is shown once at account
 * creation and never again, so this is the one later route to holding one.
 *
 * Two things the copy has to get right, because both are counter-intuitive:
 *
 * - **It is not a way back in.** It requires the password, and the phrase exists
 *   for when the password is gone. Its real job is compromise response — "my
 *   phrase leaked" — and someone arriving here after forgetting their password
 *   needs to be sent to the unlock gate instead.
 * - **Other devices catch up on their own**, at their next sync, rather than
 *   instantly. Until then the old phrase still opens *their* local files. Saying
 *   nothing would be claiming an account-wide switch that has not happened yet.
 */
function RecoveryPhraseSection({
  onRotated,
}: {
  onRotated: (revealed: { phrase: string; escrowPending: boolean }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (password === "") return;
    setError(null);
    setWorking(true);
    try {
      const { recoveryPhrase, escrowPending } =
        await window.sync.rotateRecoveryPhrase(password);
      setPassword("");
      setConfirming(false);
      // Straight into the same one-time reveal account creation uses: this is the
      // only time these words are ever displayed.
      onRotated({ phrase: recoveryPhrase, escrowPending });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't replace the phrase.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <h2>Recovery phrase</h2>
      <p>
        Your recovery phrase was shown once, when you created your account. It
        can't be shown again — if you saved it, keep it somewhere safe.
      </p>
      <p>
        If you've lost it, or think someone else has seen it, you can replace it
        with a new one. Your old phrase stops working.
      </p>
      {!confirming ? (
        <p>
          <button type="button" onClick={() => setConfirming(true)}>
            Replace recovery phrase…
          </button>
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void rotate();
          }}
        >
          <p>
            Enter your password to confirm. (This isn't a way back in if you've
            forgotten it — the phrase is what covers that.)
          </p>
          <p>
            <label>
              Password
              <br />
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </p>
          <p>
            Other devices on this account keep using the old phrase for their
            own files until they next sync, then switch over on their own.
          </p>
          <p>
            <button type="submit" disabled={password === "" || working}>
              {working ? "Replacing…" : "Replace phrase"}
            </button>{" "}
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setConfirming(false);
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </p>
        </form>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}
