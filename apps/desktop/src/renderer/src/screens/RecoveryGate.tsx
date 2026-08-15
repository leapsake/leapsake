import { useEffect, useState } from "react";

/** Which doors this store offers; mirrors the preload's `UnlockDoors`. */
interface Doors {
  password: boolean;
  phrase: boolean;
}

/**
 * The boot-time at-rest **unlock gate** (encryption `model.md` §6, §7.5). Shown
 * before the app loads when this device's enclave key is missing but the encrypted
 * database and at least one of its sidecars survive — i.e. the OS keychain was
 * reset while the data survived. The main process unwraps the whole-DB key from
 * the matching sidecar and reopens the file; a wrong secret comes back as `error`,
 * re-enabling the form.
 *
 * **The password is the primary door.** Someone who remembers their password
 * should never be sent hunting for 24 words they may never have written down — so
 * the phrase sits behind a "forgot your password?" link, which is where a user
 * expects to find it. Only the doors this store actually has are offered: a store
 * written before the password door shipped shows the phrase alone, exactly as it
 * always did.
 */
export function RecoveryGate({
  error,
  doors = { password: false, phrase: true },
}: {
  error?: string;
  doors?: Doors;
}) {
  // Which door is showing, and whether the *user* picked it. `doors` arrives
  // asynchronously (the main process reports it once it knows which sidecars
  // exist), and a `useState` initializer only runs on first mount — so seeding
  // this from the first render would strand the gate on the phrase, which is
  // exactly the fallback we don't want to lead with.
  const [door, setDoor] = useState<"password" | "phrase">("password");
  const [chosen, setChosen] = useState(false);
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Follow the doors until the user expresses a preference: prefer the password
  // whenever this store has one, and fall back to the phrase when it doesn't.
  useEffect(() => {
    if (!chosen) setDoor(doors.password ? "password" : "phrase");
  }, [chosen, doors.password]);

  // A new error means the last attempt failed — let the user try again.
  useEffect(() => {
    if (error !== undefined) setSubmitting(false);
  }, [error]);

  function submit() {
    if (secret.trim() === "") return;
    setSubmitting(true);
    void window.boot.submitUnlock({ door, secret });
  }

  function switchTo(next: "password" | "phrase") {
    setChosen(true);
    setDoor(next);
    setSecret("");
  }

  return (
    <main style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1rem" }}>
      {/*
        The copy names no cause, because this gate now has two of them: the user
        signed out deliberately (@leapsake/key-custody), or this device's secure storage
        was reset and took the key with it. It used to assert the second — "its
        secure storage was likely reset" — which reads as an alarming malfunction
        to someone who simply signed out a moment ago. Mentioning both, and
        promising the data is still here, is true either way.
      */}
      <h1>Unlock your data</h1>
      <p>
        Your data on this device is encrypted and locked — either because you
        signed out, or because this device's secure storage was reset. It is
        still here.{" "}
        {door === "password"
          ? "Enter your password to unlock it."
          : "Enter your recovery phrase to unlock it."}
      </p>

      {door === "password" ? (
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
          disabled={submitting}
          style={{ width: "100%", padding: "0.5rem" }}
        />
      ) : (
        <textarea
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          rows={4}
          placeholder="Enter your 24-word recovery phrase…"
          disabled={submitting}
          style={{ width: "100%", fontFamily: "monospace", padding: "0.5rem" }}
        />
      )}

      {error !== undefined && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      <p>
        <button type="button" onClick={submit} disabled={submitting}>
          {submitting ? "Checking…" : "Unlock"}
        </button>
      </p>

      {/* Only offered when the other door exists on this device. */}
      {door === "password" && doors.phrase && (
        <p>
          <button type="button" onClick={() => switchTo("phrase")}>
            Forgot your password? Use your 24-word recovery phrase
          </button>
        </p>
      )}
      {door === "phrase" && doors.password && (
        <p>
          <button type="button" onClick={() => switchTo("password")}>
            Use your password instead
          </button>
        </p>
      )}
    </main>
  );
}
