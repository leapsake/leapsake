import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import type { NotificationMode } from "@leapsake/core";
import { CheckboxBox } from "../components/Checkbox";
import { SelectField } from "../components/SelectField";
import { useCore, useDeviceId } from "../lib/core-context";
import { requestNotificationPermissionOnThisDevice } from "../lib/notification-permission";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";
import { Button } from "../components/Button";

/** The label on this phone's own checkbox. */
const THIS_PHONE_LABEL = "Notify me on this phone";

/** Ticked is `digest`, the only mode this screen writes; a stored `each`
 *  from a v0.1 build shows ticked too, since it is planned as `digest`. */
const modeFor = (on: boolean): NotificationMode => (on ? "digest" : "off");

/** The title on the alert a failed write raises; every write is a policy. */
const FAILURE_TITLE = "Couldn’t save that";

/** 9:00 AM, shown before this device has a policy row. */
const DEFAULT_DELIVERY_MINUTE = 540;

/** "9:00 AM" for minute 540: `deliveryMinute` counts from local midnight. */
function formatDeliveryTime(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const min = minute % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}

/** Every half-hour of the day, as strings, since `SelectField` takes one. */
const TIME_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 48 },
  (_, i) => {
    const minute = i * 30;
    return { value: String(minute), label: formatDeliveryTime(minute) };
  },
);

/**
 * Notification policy, per device and off by default: this device's pickers,
 * then every other device's row, edited through the same `setPolicy`.
 */
export default function NotificationsScreen() {
  const core = useCore();
  const deviceId = useDeviceId();
  const [permissionNotice, setPermissionNotice] = useState<{
    canAskAgain: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    const [mine, others] = await Promise.all([
      core.notificationSettings.get(deviceId),
      core.notificationSettings.list(),
    ]);
    return {
      mode: mine?.mode ?? ("off" as NotificationMode),
      deliveryMinute: mine?.deliveryMinute ?? DEFAULT_DELIVERY_MINUTE,
      others: others.filter((row) => row.id !== deviceId),
    };
  }, [core, deviceId]);
  const { data, reload } = useFocusedData(load);
  // ⚠️ The choice in flight: the picker snaps back to a `selectedValue` that
  // lags the spin, so the prop must follow the choice synchronously.
  const [pendingMine, setPendingMine] = useState<{
    mode?: NotificationMode;
    deliveryMinute?: number;
  }>({});
  const [pendingOthers, setPendingOthers] = useState<
    Record<string, NotificationMode>
  >({});

  // Asks only when leaving `off`. `wasMode` is passed, not read off `data`,
  // so it is the policy in force before this change.
  async function requestPermissionIfOptingIn(
    nextMode: NotificationMode,
    wasMode: NotificationMode,
  ) {
    if (nextMode === "off" || wasMode !== "off") return;
    const result = await requestNotificationPermissionOnThisDevice({
      deviceId,
      requestPermission: async () => {
        const response = await Notifications.requestPermissionsAsync();
        return { status: response.status, canAskAgain: response.canAskAgain };
      },
      setPermissionState: core.notificationSettings.setPermissionState,
    });
    setPermissionNotice(
      result.status === "granted" ? null : { canAskAgain: result.canAskAgain },
    );
  }

  // Every write also refreshes `label` and `platform`, so the list of devices
  // never drifts from this device's own name.
  async function setMine(patch: {
    mode?: NotificationMode;
    deliveryMinute?: number;
  }) {
    const wasMode = data?.mode ?? "off";
    setPendingMine((current) => ({ ...current, ...patch }));
    try {
      if (patch.mode === "off") setPermissionNotice(null);
      else if (patch.mode !== undefined) {
        await requestPermissionIfOptingIn(patch.mode, wasMode);
      }
      await core.notificationSettings.setPolicy(deviceId, {
        ...patch,
        label: Platform.OS === "ios" ? "iPhone" : "Android phone",
        platform: Platform.OS,
      });
      await reload();
    } catch (cause) {
      Alert.alert(FAILURE_TITLE, String(cause));
    } finally {
      // Back to the stored policy for these fields, success or failure, so a
      // picker never shows a write that did not land.
      setPendingMine((current) => {
        const next = { ...current };
        if ("mode" in patch) delete next.mode;
        if ("deliveryMinute" in patch) delete next.deliveryMinute;
        return next;
      });
    }
  }

  async function setOtherMode(otherId: string, mode: NotificationMode) {
    setPendingOthers((current) => ({ ...current, [otherId]: mode }));
    try {
      await core.notificationSettings.setPolicy(otherId, { mode });
      await reload();
    } catch (cause) {
      Alert.alert(FAILURE_TITLE, String(cause));
    } finally {
      setPendingOthers((current) => {
        const next = { ...current };
        delete next[otherId];
        return next;
      });
    }
  }

  // The choice in flight, else the stored policy.
  const mode = pendingMine.mode ?? data?.mode ?? "off";
  const deliveryMinute =
    pendingMine.deliveryMinute ??
    data?.deliveryMinute ??
    DEFAULT_DELIVERY_MINUTE;

  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.muted}>
          Get a nudge outside the app when a reminder is due — off by default,
          and nothing leaves this phone.
        </Text>
        {data !== null && (
          <View style={{ gap: 8 }}>
            <CheckboxRow
              label={THIS_PHONE_LABEL}
              checked={mode !== "off"}
              onToggle={(on) => void setMine({ mode: modeFor(on) })}
            />
            {mode !== "off" && (
              <SelectField
                label="Deliver at"
                value={String(deliveryMinute)}
                options={TIME_OPTIONS}
                onChange={(value) =>
                  void setMine({ deliveryMinute: Number(value) })
                }
              />
            )}
            {permissionNotice !== null && (
              <View style={{ gap: 8 }}>
                <Text style={styles.danger} accessibilityRole="alert">
                  Leapsake doesn't have permission to notify you on this phone,
                  so these won't be delivered here.
                </Text>
                {!permissionNotice.canAskAgain && (
                  <Button
                    label="Open Settings"
                    onPress={() => void Linking.openSettings()}
                  />
                )}
              </View>
            )}
            {data.others.length > 0 && (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={styles.sectionTitle}>Other devices</Text>
                {data.others.map((row) => (
                  <CheckboxRow
                    key={row.id}
                    label={row.label ?? row.platform ?? "Unknown device"}
                    checked={(pendingOthers[row.id] ?? row.mode) !== "off"}
                    onToggle={(on) => void setOtherMode(row.id, modeFor(on))}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

/** A row that is itself the checkbox: the whole row is the tap target. */
function CheckboxRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[styles.field, styles.rowWithLead, { paddingVertical: 8 }]}
      onPress={() => onToggle(!checked)}
    >
      <CheckboxBox checked={checked} />
      <Text style={styles.fieldValue}>{label}</Text>
    </Pressable>
  );
}
