import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { SyncStatus } from "@leapsake/core";
import { useSync } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/**
 * Account & sync setup (custody Phase 1) — the mobile mirror of desktop's
 * Settings screen. Deliberately a *stateful* screen, not a router loader: the
 * recovery key is shown exactly once and must not survive a navigation or a
 * re-run, so it lives in local state and is dropped the moment the user confirms
 * they've saved it.
 *
 * There is no sync relay yet, so this only establishes the account — a portable
 * password unlock door plus the one-time recovery key. Actual device-to-device
 * sync arrives in a later slice; the copy says so rather than implying data
 * moves now.
 */
export default function SettingsScreen() {
  const sync = useSync();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  useEffect(() => {
    void sync.status().then(setStatus);
  }, [sync]);

  // One-time reveal takes over the screen until acknowledged.
  if (recoveryKey !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={recoveryKey}
        onDone={() => {
          setRecoveryKey(null);
          void sync.status().then(setStatus);
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: "Settings" }} />
      <Text style={styles.title}>Account &amp; sync</Text>
      {status === null ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : status.enabled ? (
        <AccountEnabled status={status} />
      ) : (
        <EnableSyncForm onEnabled={setRecoveryKey} />
      )}
    </ScrollView>
  );
}

/** Shown once sync is enabled: the account exists; no re-enable is possible. */
function AccountEnabled({ status }: { status: SyncStatus }) {
  return (
    <View style={styles.section}>
      <Text style={styles.fieldValue}>Your account is set up.</Text>
      <Text style={styles.muted}>
        This device is protected by your password and recovery key. Account
        created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </Text>
      <Text style={styles.muted}>
        Device-to-device sync will arrive in a future update.
      </Text>
    </View>
  );
}

/**
 * Collect a password and enable sync. On success it hands the one-time recovery
 * key back to the parent (which switches to the reveal view); it never renders
 * the key itself.
 */
function EnableSyncForm({
  onEnabled,
}: {
  onEnabled: (recoveryKey: string) => void;
}) {
  const sync = useSync();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { recoveryKey } = await sync.enable(password);
      onEnabled(recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't enable sync.",
      );
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        Set a password to protect your account and prepare this device for sync.
        You'll be shown a one-time recovery key.
      </Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
      </View>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable style={styles.button} disabled={submitting} onPress={onSubmit}>
        <Text style={styles.buttonText}>
          {submitting ? "Setting up…" : "Set up account"}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The one-time recovery-key reveal. Irreversible: the key is never re-derivable,
 * so the user must save it and tick the acknowledgement before continuing.
 */
function RecoveryKeyReveal({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(recoveryKey);
    setCopied(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: "Save your recovery key" }} />
      <Text style={styles.title}>Save your recovery key</Text>
      <Text style={styles.muted}>
        This is shown once. Store it somewhere safe, like a password manager. If
        you lose both your password and this key, your data cannot be recovered.
      </Text>
      <Text
        selectable
        style={[styles.input, { fontFamily: "Courier", color: colors.text }]}
      >
        {recoveryKey}
      </Text>
      <Pressable style={styles.button} onPress={copy}>
        <Text style={styles.buttonText}>{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
      <View style={[styles.rowMeta, { marginTop: 0 }]}>
        <Text style={styles.fieldValue}>I've saved my recovery key</Text>
        <Switch value={acknowledged} onValueChange={setAcknowledged} />
      </View>
      <Pressable
        style={[
          styles.button,
          !acknowledged && { backgroundColor: colors.border },
        ]}
        disabled={!acknowledged}
        onPress={onDone}
      >
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}
