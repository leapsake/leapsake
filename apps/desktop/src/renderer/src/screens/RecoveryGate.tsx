import { useEffect, useState } from "react";

/**
 * The boot-time at-rest recovery prompt (encryption `model.md` §6). Shown before
 * the app loads when this device's enclave key is missing but the encrypted
 * database + its `.recovery` sidecar are present — i.e. the OS keychain was reset
 * while the data survived. The user types their recovery phrase; the main process
 * unwraps the whole-DB key from the sidecar and reopens the file. A wrong phrase
 * comes back as `error`, re-enabling the form.
 */
export function RecoveryGate({ error }: { error?: string }) {
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A new error means the last attempt failed — let the user try again.
  useEffect(() => {
    if (error !== undefined) setSubmitting(false);
  }, [error]);

  function submit() {
    if (phrase.trim() === "") return;
    setSubmitting(true);
    void window.boot.submitRecoveryPhrase(phrase);
  }

  return (
    <main style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Restore access to your data</h1>
      <p>
        This device's key is missing — its secure storage was likely reset — but
        your encrypted data is still here. Enter your recovery phrase to unlock
        it.
      </p>
      <textarea
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        rows={4}
        placeholder="Enter your 24-word recovery phrase…"
        disabled={submitting}
        style={{ width: "100%", fontFamily: "monospace", padding: "0.5rem" }}
      />
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
    </main>
  );
}
