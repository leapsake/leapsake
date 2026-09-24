/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UnlockAnswer, UnlockRequest } from "@leapsake/core";
import { useRecoveryGate } from "./use-recovery-gate";

const BOTH = { password: true, phrase: true };
const WRONG_PHRASE = "That recovery phrase doesn't open this database.";
const WRONG_PASSWORD = "That password doesn't open this database.";

type Props = UnlockRequest & { onSubmit: (answer: UnlockAnswer) => void };

function renderGate(initial: Props) {
  return renderHook((props: Props) => useRecoveryGate(props), {
    initialProps: initial,
  });
}

describe("useRecoveryGate", () => {
  it("leads with the password when the store has one", () => {
    const { result } = renderGate({ doors: BOTH, onSubmit: vi.fn() });
    expect(result.current.door).toBe("password");
  });

  it("shows the phrase when the store has no password door", () => {
    const { result } = renderGate({
      doors: { password: false, phrase: true },
      onSubmit: vi.fn(),
    });
    expect(result.current.door).toBe("phrase");
  });

  it("submits the typed secret with the door it was typed into", async () => {
    const onSubmit = vi.fn();
    const { result } = renderGate({ doors: BOTH, onSubmit });

    act(() => result.current.setSecret("correct horse battery staple"));
    act(() => result.current.submit());

    expect(result.current.submitting).toBe(true);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        door: "password",
        secret: "correct horse battery staple",
      }),
    );
  });

  it("does not submit a blank secret", () => {
    const { result } = renderGate({ doors: BOTH, onSubmit: vi.fn() });

    act(() => result.current.setSecret("   "));
    act(() => result.current.submit());

    expect(result.current.submitting).toBe(false);
  });

  it("drops the last door's error, and the typed secret, on switching doors", () => {
    const { result } = renderGate({
      error: WRONG_PHRASE,
      doors: BOTH,
      onSubmit: vi.fn(),
    });
    act(() => result.current.setSecret("george bailey"));

    act(() => result.current.switchTo("password"));

    expect(result.current.door).toBe("password");
    expect(result.current.secret).toBe("");
    expect(result.current.shownError).toBeUndefined();
  });

  it("re-enables Unlock after each failed attempt, even with the same error twice", async () => {
    const { result, rerender } = renderGate({ doors: BOTH, onSubmit: vi.fn() });

    for (const attempt of [1, 2]) {
      act(() => result.current.setSecret(`wrong ${attempt}`));
      act(() => result.current.submit());
      expect(result.current.submitting).toBe(true);

      rerender({ error: WRONG_PASSWORD, doors: BOTH, onSubmit: vi.fn() });
      await waitFor(() => expect(result.current.submitting).toBe(false));
      expect(result.current.shownError).toBe(WRONG_PASSWORD);
    }
  });

  it("keeps the door the user picked when the prompt comes back", () => {
    const { result, rerender } = renderGate({ doors: BOTH, onSubmit: vi.fn() });

    act(() => result.current.switchTo("phrase"));
    rerender({ error: WRONG_PHRASE, doors: BOTH, onSubmit: vi.fn() });

    expect(result.current.door).toBe("phrase");
    expect(result.current.shownError).toBe(WRONG_PHRASE);
  });
});
