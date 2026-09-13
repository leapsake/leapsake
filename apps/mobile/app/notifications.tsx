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
import { SelectField } from "../components/SelectField";
import { useCore, useDeviceId } from "../lib/core-context";
import { requestNotificationPermissionOnThisDevice } from "../lib/notification-permission";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/** The three-way notification mode, in the order it appears on both clients. */
const MODE_OPTIONS: { value: NotificationMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "digest", label: "Digest" },
  { value: "each", label: "One per reminder" },
];

/** The title on the alert a failed write raises. One title for the lot: every
 *  write this screen makes is the same kind of thing — a policy row for some
 *  device — so naming which one failed would say nothing the screen doesn't. */
const FAILURE_TITLE = "Couldn’t save that";

/** 9:00 AM, and what a device delivers at until somebody says otherwise. Named
 *  because two places need it: the load below, and the pickers, which have to
 *  show a time before this device has a policy row at all. */
const DEFAULT_DELIVERY_MINUTE = 540;

/** "9:00 AM" for minute 540 — matches `deliveryMinute`'s "minutes past local
 *  midnight" contract (migration 29). */
function formatDeliveryTime(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const min = minute % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}

/** Every half-hour of the day — `deliveryMinute`'s picker granularity
 *  (`plans/v0-1_08_local-notifications.md` §7). `SelectField`'s value type must
 *  be a string, so the minute travels as one and is parsed back on change. */
const TIME_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 48 },
  (_, i) => {
    const minute = i * 30;
    return { value: String(minute), label: formatDeliveryTime(minute) };
  },
);

/**
 * **Notifications** — a root-stack screen reached from the Settings tab. Moved out
 * of Settings (which used to render it unconditionally, pre-account) to stand
 * on its own alongside Holidays, Gifts, Data, etc. — nothing about the section
 * itself changed in the move.
 *
 * Notification policy is pre-account by design (Inc 1,
 * `plans/v0-1_08_local-notifications.md`) — a device gets a policy the moment
 * it mints a local id, before any account exists.
 *
 * **Notification policy** (Inc 3 §7, `plans/v0-1_08_local-notifications.md`) —
 * off by default, per-device, but editable from any device. Two pickers for
 * *this* device (mode, delivery time) plus a read-and-edit list of every
 * other device that has ever written a policy row. Editing another device's
 * row calls the exact same `setPolicy(otherId, patch)` this device's own
 * pickers call — the repo methods already take an explicit `deviceId`
 * (`packages/core/src/index.ts`), so there is no separate code path, only a
 * different id.
 *
 * `useFocusedData` (not a one-shot `useEffect`) so a peer's edit — including
 * one made *to this device's own row*, from another device — appears on
 * return to this screen or on the next background-sync pull, without a
 * manual refresh.
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
  /**
   * What the user has just chosen, for as long as the write and the reload
   * behind it take to make it true.
   *
   * ⚠️ **Without this the pickers flicker A → B → A → B**, and the cause is in
   * `@react-native-picker/picker` rather than here. Spinning the wheel moves it
   * natively *and* fires `onValueChange`; the picker then compares the index
   * native landed on against the one its `selectedValue` prop still names, and
   * when they differ commands native **back** to the prop. Every value on this
   * screen is read from the database, so between the spin and the reload the
   * prop still says A: the picker snaps back to it, then jumps to B when the
   * reload finally lands. Opting in makes the trip long enough to be
   * unmissable, since it waits on the OS permission dialog before anything is
   * written at all.
   *
   * So the prop has to follow the choice *synchronously*, which is what this is
   * — an overlay, not a copy. The screen still reads through to the stored
   * policy, so a peer's edit arriving on a sync pull still appears (see
   * {@link useFocusedData}); only the value being written is held here, and only
   * until it is written.
   */
  const [pendingMine, setPendingMine] = useState<{
    mode?: NotificationMode;
    deliveryMinute?: number;
  }>({});
  const [pendingOthers, setPendingOthers] = useState<
    Record<string, NotificationMode>
  >({});

  // request-at-opt-in (§4): only when the picker leaves `off`, never at
  // launch and never for a device that is already asking. `wasMode` is passed
  // rather than read back off `data`, so it is the policy in force *before* this
  // change whatever the overlay above is currently showing.
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

  // This device's own row: every write also refreshes `label`/`platform`
  // (`Platform.OS`-derived — no `expo-device`, see the plan doc), so the
  // cross-device list and this device's own display name never drift apart.
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
      // Back to reading the stored policy either way, and only for the fields
      // this write carried: after a reload that *is* the value just chosen, and
      // after a failure it is the one actually in force. A picker still showing
      // a write that never landed would be lying rather than merely flickering.
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

  // What this device's two pickers show: the choice in flight if there is one,
  // else the stored policy. `data` is null only before the first load, when
  // nothing that reads these is on screen.
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
            <SelectField
              label="On this phone"
              value={mode}
              options={MODE_OPTIONS}
              onChange={(next) => void setMine({ mode: next })}
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
                  <Pressable
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={() => void Linking.openSettings()}
                  >
                    <Text style={styles.buttonText}>Open Settings</Text>
                  </Pressable>
                )}
              </View>
            )}
            {data.others.length > 0 && (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={styles.sectionTitle}>Other devices</Text>
                {data.others.map((row) => (
                  <SelectField
                    key={row.id}
                    label={row.label ?? row.platform ?? "Unknown device"}
                    value={pendingOthers[row.id] ?? row.mode}
                    options={MODE_OPTIONS}
                    onChange={(next) => void setOtherMode(row.id, next)}
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
