import { describe, expect, it } from "vitest";
import {
  type NotificationPermissionResult,
  requestNotificationPermissionOnThisDevice,
} from "./notification-permission";

const DEVICE = "device-1";

const request =
  (result: NotificationPermissionResult) =>
  async (): Promise<NotificationPermissionResult> =>
    result;

describe("requestNotificationPermissionOnThisDevice", () => {
  it("persists a granted result under this device's id", async () => {
    const persisted: Array<[string, string]> = [];

    const result = await requestNotificationPermissionOnThisDevice({
      deviceId: DEVICE,
      requestPermission: request({ status: "granted", canAskAgain: true }),
      setPermissionState: async (deviceId, state) => {
        persisted.push([deviceId, state]);
      },
    });

    expect(result).toEqual({ status: "granted", canAskAgain: true });
    expect(persisted).toEqual([[DEVICE, "granted"]]);
  });

  it("persists a denial the same way, carrying canAskAgain so the caller can choose retry vs. Open Settings", async () => {
    const persisted: Array<[string, string]> = [];

    const result = await requestNotificationPermissionOnThisDevice({
      deviceId: DEVICE,
      requestPermission: request({ status: "denied", canAskAgain: false }),
      setPermissionState: async (deviceId, state) => {
        persisted.push([deviceId, state]);
      },
    });

    expect(result).toEqual({ status: "denied", canAskAgain: false });
    expect(persisted).toEqual([[DEVICE, "denied"]]);
  });

  it("persists under the requesting device's id, not some default", async () => {
    const persisted: string[] = [];

    await requestNotificationPermissionOnThisDevice({
      deviceId: "some-other-device",
      requestPermission: request({
        status: "undetermined",
        canAskAgain: true,
      }),
      setPermissionState: async (deviceId) => {
        persisted.push(deviceId);
      },
    });

    expect(persisted).toEqual(["some-other-device"]);
  });
});
