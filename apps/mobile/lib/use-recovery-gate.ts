import { useEffect, useState } from "react";
import type { UnlockAnswer, UnlockRequest } from "@leapsake/core";

type Door = UnlockAnswer["door"];

/**
 * The unlock gate's state: which door shows (the password, when the store has
 * one, until the user picks), the typed secret, and the error for this door only.
 */
export function useRecoveryGate({
  error,
  doors,
  onSubmit,
}: UnlockRequest & { onSubmit: (answer: UnlockAnswer) => void }) {
  const [door, setDoor] = useState<Door>("password");
  const [chosen, setChosen] = useState(false);
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [staleError, setStaleError] = useState(false);

  useEffect(() => {
    if (!chosen) setDoor(doors.password ? "password" : "phrase");
  }, [chosen, doors.password]);

  // Each attempt brings a new `onSubmit`; the same error twice does not re-fire.
  useEffect(() => {
    setSubmitting(false);
    setStaleError(false);
  }, [onSubmit]);

  function submit() {
    if (secret.trim() === "") return;
    setSubmitting(true);
    // Two frames, so "Checking…" paints before the key derivation blocks the thread.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => onSubmit({ door, secret })),
    );
  }

  function switchTo(next: Door) {
    setChosen(true);
    setDoor(next);
    setSecret("");
    setStaleError(true);
  }

  return {
    door,
    secret,
    setSecret,
    submitting,
    shownError: staleError ? undefined : error,
    submit,
    switchTo,
  };
}
