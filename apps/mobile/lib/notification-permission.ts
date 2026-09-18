/**
 * The permission request and its persistence. Injected ports, mirroring
 * `forget-account.ts`'s convention for OS-touching calls: keeps this testable
 * without mocking `expo-notifications`, and leaves the real
 * `Notifications.requestPermissionsAsync` call assembled at the actual call
 * site — the settings mode picker — rather than behind a factory here,
 * since that is the only place this may legitimately run (**never at
 * launch**, only at the moment the user turns notifications on).
 *
 * Always requests, never checks first: like `import.tsx`'s
 * `readDeviceContacts`, this assumes the platform's own permission API
 * already no-ops a repeat ask once the user has answered — a granted or
 * denied request just echoes the existing status rather than re-prompting.
 */
export interface NotificationPermissionResult {
  status: "granted" | "denied" | "undetermined";
  /**
   * False once the platform has asked and been refused — the point in
   * `import.tsx`'s pattern where the caller should stop offering a retry and
   * fall back to `Linking.openSettings()` instead.
   */
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
