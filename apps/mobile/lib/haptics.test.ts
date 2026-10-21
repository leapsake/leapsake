import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationAsync = vi.fn<(type: string) => Promise<void>>();
const selectionAsync = vi.fn<() => Promise<void>>();

vi.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  notificationAsync,
  selectionAsync,
}));

const { haptic } = await import("./haptics");

beforeEach(() => {
  notificationAsync.mockReset().mockResolvedValue(undefined);
  selectionAsync.mockReset().mockResolvedValue(undefined);
});

describe("haptic", () => {
  it("plays the success cue for done", () => {
    haptic.done();
    expect(notificationAsync).toHaveBeenCalledWith("success");
  });

  it("plays the selection cue for a tick", () => {
    haptic.ticked();
    expect(selectionAsync).toHaveBeenCalledOnce();
  });

  it("returns before the cue finishes, so it never delays the action", () => {
    selectionAsync.mockReturnValue(new Promise(() => {}));
    expect(haptic.ticked()).toBeUndefined();
  });

  it("swallows a cue that throws before it starts", () => {
    notificationAsync.mockImplementation(() => {
      throw new Error("no native module");
    });
    expect(() => haptic.done()).not.toThrow();
  });
});
