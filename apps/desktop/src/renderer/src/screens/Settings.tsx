import type { SyncStatus } from "@leapsake/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

/**
 * Account settings (custody Phase 1/2). Deliberately a *stateful* screen, not
 * a router loader/action: the recovery key is shown exactly once and must not
 * survive a navigation or a loader re-run, so it lives in local state and is
 * dropped the moment the user confirms they've saved it.
 */
export function Settings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  // The phrase currently on screen for its one-and-only showing — from account
  // creation, or from the rotation that replaced it.
  const [revealed, setRevealed] = useState<string | null>(null);

  function refreshStatus() {
    void window.account.status().then(setStatus);
  }

  useEffect(refreshStatus, []);

  // One-time reveal takes over the screen until acknowledged. The main process
  // has already re-opened the app around the converted store, so "Done" simply
  // drops the phrase and returns to Settings — now reporting the new account.
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

      {/*
        Last, and outside the custody branch above on purpose: it is about the app
        rather than about this device's account, so it is here in both states and
        readable before anyone has one.
      */}
      <hr />
      <h2>About</h2>
      <p>
        <Link to="/acknowledgements">Acknowledgements</Link>
      </p>
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
 * the promise is *nobody can see my data on this device anymore*. The one
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
 * **Forget account** (`model.md` §7.3) — remove this account and its data from
 * this device. Named as removal so it can never be mistaken for signing out.
 *
 * The wording is **driven by a check, not hardcoded** (§7.3.1). Forgetting an
 * account on its last remaining device is functionally a deletion unless a server
 * durably holds a copy, so the main process asks and reports `durableBackup`;
 * absent an answer — today's universal case — it is `false` and this shows the
 * alarming version, hard-confirm and all. When server-side backup ships, the
 * alarming copy stops appearing on its own rather than having to be hunted down.
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

/** The numbered word grid + a copy button — used by the one-time reveal, which
 *  is the *only* place a phrase is ever displayed (at account creation, and at
 *  the rotation that replaces it). */
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
 * **Shown only while this device is Unauthenticated** (`model.md` §7.2) — with an account,
 * {@link ForgetAccount} is the same act under the name that fits, and offering
 * both was offering one act twice. An Unauthenticated device has no account, so
 * the data here is by definition the only copy, and "erase" means exactly what it
 * says.
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
 * Replace the recovery phrase — **only rendered once an account exists**, and only
 * ever a *replacement*. The phrase is shown once at account creation and never
 * again, so this is the one later route to holding one.
 *
 * The copy has to get this right, because it is counter-intuitive: **it is not a
 * way back in.** It requires the password, and the phrase exists for when the
 * password is gone. Its real job is compromise response — "my phrase leaked" —
 * and someone arriving here after forgetting their password needs to be sent to
 * the unlock gate instead.
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
      // Straight into the same one-time reveal account creation uses: this is the
      // only time these words are ever displayed.
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
