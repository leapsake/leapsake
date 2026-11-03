import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { type SyncActivity, RelayError } from "@leapsake/account-flows";
import type { SyncStatus } from "@leapsake/core";
import { Button } from "../../components/Button";
import { FormScrollView } from "../../components/FormScrollView";
import { PasswordInput } from "../../components/PasswordInput";
import { useAccount } from "../../lib/core-context";
import { styles } from "../../lib/styles";
import { SYNC_PREVIEW_MARKER } from "../preview";

const TEXT = {
  title: "Sync",
  loading: "Loading…",
  preview:
    "A preview, only in development builds. Point it at a relay you run yourself.",
  relayUrl: "Relay address",
  relayUrlPlaceholder: "http://localhost:4000",
  username: "Username",
  password: "Password",
  recoveryPhrase: "Recovery phrase",
  newPassword: "New password",
  joinTitle: "Join your account",
  joinIntro:
    "Already using Leapsake on another device that syncs? Sign in to bring this device into the same account.",
  join: "Join",
  joining: "Joining…",
  usePhrase: "Forgot your password? Use your recovery phrase",
  usePassword: "Use your password instead",
  recover: "Recover",
  recovering: "Recovering…",
  startTitle: "Start syncing",
  startIntro:
    "Publish this device's account to a relay, so other devices can join it. Your password and recovery phrase stay the same.",
  start: "Start syncing",
  starting: "Starting…",
  taken:
    "That username is already taken on this relay. If it is your own account, enter its password to move this device into it. Otherwise, go back and pick another username.",
  mergeTitle: "Move into your existing account",
  mergeIntro:
    "Sign in to the account you use on your other devices. Everything on this device moves into it and syncs, and from then on this device opens with that account's password. People on both are kept, and possible duplicates go to review.",
  merge: "Move into this account",
  merging: "Moving…",
  useMerge: "Already have an account that syncs? Move into it",
  useStart: "Publish this device's account instead",
  syncingTitle: "Syncing",
  syncingAs: (username: string, relayUrl: string) =>
    `As ${username}, through ${relayUrl}.`,
  lastSynced: (at: number) =>
    `Last synced ${new Date(at).toLocaleTimeString()}.`,
  notSyncedYet: "Not synced yet on this launch.",
  syncNow: "Sync now",
  reconnectIntro:
    "Your password was changed on another device. Enter the new one to keep this device syncing.",
  reconnect: "Reconnect",
  reconnecting: "Reconnecting…",
  syncingNow: "Syncing…",
  required: "Fill in every field.",
  reasons: {
    unreachable:
      "Couldn't reach the relay. Check the address, and that it is running.",
    "username-taken": "That username is already taken on this relay.",
    unauthorized:
      "The relay didn't accept those details. If you changed your password on another device, use the new one.",
    "not-found": "There is no account with that username on this relay.",
    failed: "The relay couldn't do that just now. Try again.",
    other: "Something went wrong while syncing.",
  },
  failed: "Something went wrong.",
} as const;

/** What to show for a failed account act or sync run. */
function problem(cause: unknown): string {
  if (cause instanceof RelayError) return TEXT.reasons[cause.reason];
  return cause instanceof Error ? cause.message : TEXT.failed;
}

/** The sync preview: join an account, publish this one, or show its sync. */
export default function SyncSettingsScreen() {
  const account = useAccount();
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // A join swaps the store, which brings a new `account` and re-reads this.
  function refresh() {
    void account.status().then(setStatus);
  }
  useEffect(refresh, [account]);

  return (
    <>
      <Stack.Screen options={{ title: TEXT.title }} />
      <FormScrollView
        nativeID={SYNC_PREVIEW_MARKER}
        contentContainerStyle={styles.screen}
      >
        <Text style={styles.muted}>{TEXT.preview}</Text>
        {status === null ? (
          <Text style={styles.muted}>{TEXT.loading}</Text>
        ) : !status.hasAccount ? (
          <JoinForm />
        ) : status.relayUrl === undefined ? (
          <StartSyncingForm status={status} onBound={refresh} />
        ) : (
          <SyncingPanel username={status.username} relayUrl={status.relayUrl} />
        )}
      </FormScrollView>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {secret ? (
        <PasswordInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
        />
      ) : (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}
    </View>
  );
}

function Problem({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {text}
    </Text>
  );
}

/** Join, or recover with the phrase. Success swaps the store underneath. */
function JoinForm() {
  const account = useAccount();
  const [door, setDoor] = useState<"password" | "phrase">("password");
  const [relayUrl, setRelayUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    const filled = [relayUrl, username, secret].every((v) => v.trim() !== "");
    if (!filled || (door === "phrase" && newPassword === "")) {
      setError(TEXT.required);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (door === "password") {
        await account.joinAccount({
          relayUrl: relayUrl.trim(),
          username,
          password: secret,
        });
      } else {
        await account.recoverAccount({
          relayUrl: relayUrl.trim(),
          username,
          recoveryPhrase: secret,
          newPassword,
        });
      }
    } catch (cause) {
      setError(problem(cause));
      setBusy(false);
    }
  }

  const submitLabel =
    door === "password"
      ? busy
        ? TEXT.joining
        : TEXT.join
      : busy
        ? TEXT.recovering
        : TEXT.recover;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{TEXT.joinTitle}</Text>
      <Text style={styles.muted}>{TEXT.joinIntro}</Text>
      <Field
        label={TEXT.relayUrl}
        value={relayUrl}
        onChange={setRelayUrl}
        placeholder={TEXT.relayUrlPlaceholder}
      />
      <Field label={TEXT.username} value={username} onChange={setUsername} />
      {door === "password" ? (
        <Field
          label={TEXT.password}
          value={secret}
          onChange={setSecret}
          secret
        />
      ) : (
        <>
          <Field
            label={TEXT.recoveryPhrase}
            value={secret}
            onChange={setSecret}
          />
          <Field
            label={TEXT.newPassword}
            value={newPassword}
            onChange={setNewPassword}
            secret
          />
        </>
      )}
      <Problem text={error} />
      <Button label={submitLabel} busy={busy} onPress={() => void submit()} />
      <Button
        label={door === "password" ? TEXT.usePhrase : TEXT.usePassword}
        tone="secondary"
        onPress={() => {
          setDoor(door === "password" ? "phrase" : "password");
          setSecret("");
          setError(null);
        }}
      />
    </View>
  );
}

/**
 * Publish the account already here, or move it into one that already syncs;
 * a taken username leads to the second, since it may be the user's own.
 */
function StartSyncingForm({
  status,
  onBound,
}: {
  status: SyncStatus;
  onBound: () => void;
}) {
  const account = useAccount();
  const [mode, setMode] = useState<"start" | "merge">("start");
  const [relayUrl, setRelayUrl] = useState("");
  const [username, setUsername] = useState(status.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    const filled = relayUrl.trim() !== "" && username.trim() !== "";
    if (!filled || (mode === "merge" && password === "")) {
      setError(TEXT.required);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (mode === "merge") {
        // Success swaps the store, which re-reads this screen's status.
        await account.mergeIntoAccount({
          relayUrl: relayUrl.trim(),
          username,
          password,
        });
        return;
      }
      const result = await account.startSyncing({
        relayUrl: relayUrl.trim(),
        username,
      });
      if (result.status === "bound") {
        onBound();
        return;
      }
      setMode("merge");
      setNote(TEXT.taken);
    } catch (cause) {
      setError(problem(cause));
    }
    setBusy(false);
  }

  const submitLabel =
    mode === "start"
      ? busy
        ? TEXT.starting
        : TEXT.start
      : busy
        ? TEXT.merging
        : TEXT.merge;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {mode === "start" ? TEXT.startTitle : TEXT.mergeTitle}
      </Text>
      <Text style={styles.muted}>
        {mode === "start" ? TEXT.startIntro : TEXT.mergeIntro}
      </Text>
      {note !== null && <Text style={styles.muted}>{note}</Text>}
      <Field
        label={TEXT.relayUrl}
        value={relayUrl}
        onChange={setRelayUrl}
        placeholder={TEXT.relayUrlPlaceholder}
      />
      <Field label={TEXT.username} value={username} onChange={setUsername} />
      {mode === "merge" && (
        <Field
          label={TEXT.password}
          value={password}
          onChange={setPassword}
          secret
        />
      )}
      <Problem text={error} />
      <Button label={submitLabel} busy={busy} onPress={() => void submit()} />
      <Button
        label={mode === "start" ? TEXT.useMerge : TEXT.useStart}
        tone="secondary"
        onPress={() => {
          setMode(mode === "start" ? "merge" : "start");
          setNote(null);
          setError(null);
        }}
      />
    </View>
  );
}

/** A relay-bound account: where it syncs, the last run, and a manual run;
 *  a password changed elsewhere asks for the new one. */
function SyncingPanel({
  username,
  relayUrl,
}: {
  username: string | undefined;
  relayUrl: string;
}) {
  const account = useAccount();
  const [last, setLast] = useState<SyncActivity | null>(() =>
    account.lastSyncActivity(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => account.onSyncActivity(setLast), [account]);

  async function syncNow() {
    if (busy) return;
    setBusy(true);
    try {
      await account.syncNow();
    } catch {
      // Reported through the activity listener.
    }
    setBusy(false);
  }

  const needsPassword =
    last?.kind === "failed" && last.reason === "unauthorized";

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{TEXT.syncingTitle}</Text>
      <Text style={styles.muted}>
        {TEXT.syncingAs(username ?? "", relayUrl)}
      </Text>
      {needsPassword ? (
        <ReconnectForm />
      ) : (
        <>
          <Text style={styles.muted}>
            {last?.kind === "synced"
              ? TEXT.lastSynced(last.at)
              : TEXT.notSyncedYet}
          </Text>
          <Problem
            text={last?.kind === "failed" ? TEXT.reasons[last.reason] : null}
          />
          <Button
            label={busy ? TEXT.syncingNow : TEXT.syncNow}
            busy={busy}
            onPress={() => void syncNow()}
          />
        </>
      )}
    </View>
  );
}

/** The new password; success syncs, which takes this form away. */
function ReconnectForm() {
  const account = useAccount();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (password === "") {
      setError(TEXT.required);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await account.reauthenticate(password);
    } catch (cause) {
      setError(problem(cause));
    }
    setBusy(false);
  }

  return (
    <>
      <Text style={styles.muted}>{TEXT.reconnectIntro}</Text>
      <Field
        label={TEXT.password}
        value={password}
        onChange={setPassword}
        secret
      />
      <Problem text={error} />
      <Button
        label={busy ? TEXT.reconnecting : TEXT.reconnect}
        busy={busy}
        onPress={() => void submit()}
      />
    </>
  );
}
