import type { SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

/**
 * Stateful rather than a loader: the recovery phrase is shown once and must not
 * survive a navigation or a loader re-run.
 */
export function Settings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  // From account creation, or from a rotation.
  const [revealed, setRevealed] = useState<string | null>(null);

  function refreshStatus() {
    void window.account.status().then(setStatus);
  }

  useEffect(refreshStatus, []);

  // The store is already live again, so "Done" just drops the phrase.
  if (revealed !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={revealed}
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
      <h2>Account</h2>

      {status === null ? (
        <p>Loading…</p>
      ) : status.hasAccount ? (
        <AccountEnabled status={status} />
      ) : (
        <CreateAccount onCreated={setRevealed} />
      )}

      {/* One exit per custody state: Forget account, or factory reset. */}
      {status !== null &&
        (status.hasAccount ? (
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

      {/* About the app, not the account, so shown in both states. */}
      <hr />
      <h2>About</h2>
      <p>
        <Link to="/acknowledgements">Acknowledgements</Link>
      </p>
    </main>
  );
}

/** Close the store and forget its keys; the password reopens it. */
function SignOut() {
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    setError(null);
    // Not awaited: it resolves only after the user passes the unlock gate. A
    // rejection means it was refused up front, with this screen still on top.
    window.account.signOut().catch((cause: unknown) => {
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
 * Remove this account and its data from this device. The wording and the hard
 * confirm follow `durableBackup`, false unless the relay says otherwise.
 */
function ForgetAccount() {
  const [info, setInfo] = useState<{
    username?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function beginConfirm() {
    setError(null);
    window.account
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

  // Nothing keeps a durable copy, so the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await window.account.forgetAccount();
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
            This account is only on this device, so there is no other copy.
          </p>
          <p>
            If you might want this data later, close this and export your data
            first.
          </p>
          <p>
            Type <strong>{FORGET_ACCOUNT_PHRASE}</strong> to confirm.
          </p>
        </>
      ) : (
        <p>
          Remove{" "}
          {info.username !== undefined ? `“${info.username}”` : "this account"}{" "}
          from this device? A copy of your data is kept elsewhere, so you can
          get it again.
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

/** Shown once this device has an account: what it is, and where it lives. */
function AccountEnabled({ status }: { status: SyncStatus }) {
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
        Account created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </p>
      <p>
        This account is on this computer only. Nothing is sent anywhere, and
        nothing leaves this device.
      </p>
    </>
  );
}

/**
 * Create an account, entirely locally, which turns encryption on. The copy
 * promises access, not safety, and names backups rather than implying them.
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
      const { recoveryPhrase } = await window.account.createAccount({
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
        back. Keep a backup for that.
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
 * A fixed overlay over the nav, so a stray click cannot navigate away with the
 * only copy of the phrase; continuing needs the acknowledgement ticked.
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

/** The numbered word grid and a copy button, for the one-time reveal. */
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
 * Erase everything on an Unauthenticated device, where the data is the only
 * copy. The main process reloads the renderer, so there is no done state.
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
      await window.account.factoryReset();
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
 * The only later route to a phrase. Not a way back in: it needs the password,
 * so the copy sends a user who forgot theirs to the unlock gate.
 */
function RecoveryPhraseSection({
  onRotated,
}: {
  onRotated: (phrase: string) => void;
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
      const { recoveryPhrase } =
        await window.account.rotateRecoveryPhrase(password);
      setPassword("");
      setConfirming(false);
      // The same one-time reveal account creation uses.

      onRotated(recoveryPhrase);
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
