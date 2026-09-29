/**
 * Asked only when the user turns notifications on, never at launch. Always
 * requests: the platform answers a repeat ask without prompting again.
 */
export interface NotificationPermissionResult {
  status: "granted" | "denied" | "undetermined";
  /** False once refused: offer `Linking.openSettings()` instead of a retry. */
  canAskAgain: boolean;
}

export async function requestNotificationPermissionOnThisDevice(opts: {
  deviceId: string;
  requestPermission: () => Promise<NotificationPermissionResult>;
  setPermissionState: (deviceId: string, state: string) => Promise<unknown>;
}): Promise<NotificationPermissionResult> {
  const result = await opts.requestPermission();
  await opts.setPermissionState(opts.deviceId, result.status);
  return result;
}
