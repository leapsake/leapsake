import { useEffect, useState } from "react";

/** Which doors this store offers; mirrors the preload's `UnlockDoors`. */
interface Doors {
  password: boolean;
  phrase: boolean;
}

/**
 * The unlock gate for a locked encrypted store. The password is the primary
 * door, with the phrase behind "forgot your password?"; a wrong secret re-asks.
 */
export function RecoveryGate({
  error,
  doors = { password: false, phrase: true },
}: {
  error?: string;
  doors?: Doors;
}) {
  // Not seeded from `doors`, which arrives after first mount: the effect below
  // follows it until the user picks a door.
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
      {/* Names both causes, signing out and a reset keychain, since either
          may have brought the user here. */}
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
