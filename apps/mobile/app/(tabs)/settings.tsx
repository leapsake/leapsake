import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Link } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { useCore, useSync } from "../../lib/core-context";
import { colors, styles } from "../../lib/styles";

/**
 * Mirror of the core's `MIN_PASSWORD_LENGTH` boundary check — keep them in step.
 * This password derives the encryption key for a zero-knowledge store with no
 * server-side reset, so the floor is deliberately higher than a typical login.
 */
const MIN_PASSWORD_LENGTH = 12;

/** Prefilled relay origin for local development (apps/server defaults to :4000). */
const DEFAULT_RELAY_URL = "http://localhost:4000";

/**
 * A humble, dependency-free password hint. It does not score entropy (no
 * zxcvbn) — it enforces the length floor and steers toward a passphrase, which
 * is the guidance that actually helps for a key-deriving secret.
 */
function passwordHint(password: string): string {
  if (password === "") return "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Too short — use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!password.includes(" ") && password.length < 16) {
    return "A passphrase of 3–4 random words is stronger than a short complex password.";
  }
  return "Looks reasonable. Longer is stronger.";
}

/**
 * Account & sync setup (custody Phase 1/2) — the mobile mirror of desktop's
 * Settings screen. Deliberately a *stateful* screen, not a router loader: the
 * recovery key is shown exactly once and must not survive a navigation or a
 * re-run, so it lives in local state and is dropped the moment the user confirms
 * they've saved it.
 *
 * Device-to-device sync is real now (multi-device-login.md Phase C): a first
 * device sets a password + username and registers with a relay; a second device
 * logs in to the same account; "Sync now" pushes/pulls the encrypted records.
 */
export default function SettingsScreen() {
  const sync = useSync();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  // How many possible duplicates the most recent join surfaced — a prompt to
  // review them (0 = nothing to review). Set when a join completes.
  const [reviewCount, setReviewCount] = useState(0);

  function refreshStatus() {
    void sync.status().then(setStatus);
  }

  function onJoined(duplicateCount: number) {
    setReviewCount(duplicateCount);
    refreshStatus();
  }

  useEffect(refreshStatus, [sync]);

  // One-time reveal takes over the screen until acknowledged.
  if (recoveryKey !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={recoveryKey}
        onDone={() => {
          setRecoveryKey(null);
          refreshStatus();
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Account &amp; sync</Text>
      {status === null ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : status.enabled ? (
        <AccountEnabled
          status={status}
          reviewCount={reviewCount}
          onReviewed={() => setReviewCount(0)}
          onCleared={refreshStatus}
        />
      ) : (
        <SyncSetup onEnabled={setRecoveryKey} onJoined={onJoined} />
      )}
      <RecoveryPhraseSection />
    </ScrollView>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  reviewCount,
  onReviewed,
  onCleared,
}: {
  status: SyncStatus;
  reviewCount: number;
  onReviewed: () => void;
  onCleared: () => void;
}) {
  const sync = useSync();
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // The per-client "Sync automatically" preference (default on). Null until loaded.
  const [autoSync, setAutoSync] = useState<boolean | null>(null);

  // Background syncs (interval / foreground / after a local write) finish out of
  // band, so subscribe to keep the "last synced" line and error current even when
  // the user didn't tap the button.
  useEffect(
    () =>
      sync.onActivity((payload) => {
        if (payload.at !== undefined) {
          setLastSynced(payload.at);
          setError(null);
        }
        if (payload.error !== undefined) setError(payload.error);
      }),
    [sync],
  );

  // Load the current "Sync automatically" preference once.
  useEffect(() => {
    void sync.getAutoSync().then(setAutoSync);
  }, [sync]);

  async function toggleAutoSync(next: boolean) {
    setAutoSync(next); // optimistic; the SyncApi call is the source of truth
    await sync.setAutoSync(next);
  }

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const { at } = await sync.syncNow();
      setLastSynced(at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't sync.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View style={styles.section}>
      {reviewCount > 0 && (
        <Text style={styles.muted} accessibilityRole="summary">
          Logging in found {reviewCount} possible{" "}
          {reviewCount === 1 ? "duplicate" : "duplicates"} between this device
          and your account.{" "}
          <Link href="/duplicates" style={styles.link} onPress={onReviewed}>
            Review duplicates
          </Link>
        </Text>
      )}
      <Text style={styles.fieldValue}>Your account is set up.</Text>
      <Text style={styles.muted}>
        This device is protected by your password and recovery key.
        {status.username !== undefined && ` Username ${status.username}.`}
        {status.relayUrl !== undefined && ` Relay ${status.relayUrl}.`} Account
        created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </Text>
      {status.relayUrl !== undefined && autoSync !== null && (
        <>
          <View style={styles.rowMeta}>
            <Text style={styles.fieldValue}>Sync automatically</Text>
            <Switch
              value={autoSync}
              onValueChange={(next) => void toggleAutoSync(next)}
            />
          </View>
          {!autoSync && (
            <Text style={styles.muted}>
              Changes sync only when you tap “Sync now” on this device.
            </Text>
          )}
        </>
      )}
      <Pressable style={styles.button} disabled={syncing} onPress={syncNow}>
        <Text style={styles.buttonText}>
          {syncing ? "Syncing…" : "Sync now"}
        </Text>
      </Pressable>
      {lastSynced !== null && (
        <Text style={styles.muted}>
          Last synced {new Date(lastSynced).toLocaleTimeString()}.
        </Text>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <DisconnectAccount onCleared={onCleared} />
    </View>
  );
}

/**
 * Disconnect the account from this device. Two-step (a confirm) because it
 * revokes the password + recovery key for this account — though the local data
 * stays readable (the master key survives in the device enclave) and sync can be
 * set up again afterward.
 */
function DisconnectAccount({ onCleared }: { onCleared: () => void }) {
  const sync = useSync();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function disconnect() {
    setError(null);
    setWorking(true);
    try {
      await sync.clear();
      onCleared();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't disconnect.");
      setWorking(false);
    }
  }

  if (!confirming) {
    return (
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        onPress={() => setConfirming(true)}
      >
        <Text style={styles.buttonText}>
          Disconnect account from this device
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        Remove this account from this device? Your data stays on this device and
        you can set up sync again, but the current password and recovery key for
        this account will no longer work.
      </Text>
      <Pressable style={styles.button} disabled={working} onPress={disconnect}>
        <Text style={styles.buttonText}>
          {working ? "Disconnecting…" : "Yes, disconnect"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        disabled={working}
        onPress={() => setConfirming(false)}
      >
        <Text style={styles.buttonText}>Cancel</Text>
      </Pressable>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

/**
 * The combined sign-up / log-in flow (identity-first, like "continue with
 * email"). Step 1 takes a relay + username and asks the relay whether that
 * account exists (`sync.lookup`) — a miss routes to **create an account**, a hit
 * routes to **log in**. Both branches then require an explicit confirmation
 * before the dangerous action runs.
 */
function SyncSetup({
  onEnabled,
  onJoined,
}: {
  onEnabled: (recoveryKey: string) => void;
  onJoined: (duplicateCount: number) => void;
}) {
  const sync = useSync();
  const [username, setUsername] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [resolved, setResolved] = useState<{ exists: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContinue() {
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "") {
      setError("Username and relay URL are required.");
      return;
    }
    setChecking(true);
    try {
      setResolved({ exists: await sync.lookup(username, relayUrl) });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't reach the relay.",
      );
    } finally {
      setChecking(false);
    }
  }

  // Step 2: branch on whether the account already exists.
  if (resolved !== null) {
    const back = () => {
      setResolved(null);
      setError(null);
    };
    return resolved.exists ? (
      <LoginStep
        username={username}
        relayUrl={relayUrl}
        onBack={back}
        onJoined={onJoined}
      />
    ) : (
      <SignupStep
        username={username}
        relayUrl={relayUrl}
        onBack={back}
        onEnabled={onEnabled}
      />
    );
  }

  // Step 1: identity.
  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        Enter a username and relay. We'll check whether that account exists,
        then help you create it or log in.
      </Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoComplete="username"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Relay URL</Text>
        <TextInput
          style={styles.input}
          value={relayUrl}
          onChangeText={setRelayUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
      </View>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable style={styles.button} disabled={checking} onPress={onContinue}>
        <Text style={styles.buttonText}>
          {checking ? "Checking…" : "Continue"}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Create-account branch: the username is free on the relay. Collect a password
 * (with confirmation), then require an explicit confirm before creating the
 * account — after which the parent reveals the one-time recovery key.
 */
function SignupStep({
  username,
  relayUrl,
  onBack,
  onEnabled,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onEnabled: (recoveryKey: string) => void;
}) {
  const sync = useSync();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function onSubmit() {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setConfirming(true);
  }

  async function create() {
    setError(null);
    setWorking(true);
    try {
      const { recoveryKey } = await sync.enable({
        username,
        password,
        relayUrl,
      });
      onEnabled(recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't create the account.",
      );
      setWorking(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <View style={styles.section}>
        <Text style={styles.fieldValue}>Create this account?</Text>
        <Text style={styles.muted}>
          This creates a new account “{username}” on {relayUrl}. You'll be shown
          a one-time recovery key to save.
        </Text>
        <Pressable style={styles.button} disabled={working} onPress={create}>
          <Text style={styles.buttonText}>
            {working ? "Creating…" : "Create account"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          disabled={working}
          onPress={() => setConfirming(false)}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    );
  }

  const hint = passwordHint(password);

  return (
    <View style={styles.section}>
      <Text style={styles.fieldValue}>Create account “{username}”</Text>
      <Text style={styles.muted}>
        No account named “{username}” exists on {relayUrl}. Choose a password to
        create one and sync across devices.
      </Text>
      <Text style={styles.muted}>
        There is no password reset. Leapsake can't see your password, so if you
        forget it and have no other signed-in device, only your recovery key can
        recover your data. You'll be shown that key next — save it.
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
        {hint !== "" && <Text style={styles.muted}>{hint}</Text>}
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
      <Pressable style={styles.button} onPress={onSubmit}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        onPress={onBack}
      >
        <Text style={styles.buttonText}>Back</Text>
      </Pressable>
    </View>
  );
}

/**
 * Log-in branch: the account exists. Collect the password, then require an
 * explicit confirm before joining. Joining **keeps** this device's local data
 * and reconciles it with the account's (reconcile-on-join, reconciliation
 * Increment C): the two sets are combined and any possible duplicates are
 * surfaced for the user to review and merge, so the confirm notes that rather
 * than warning of data loss.
 */
function LoginStep({
  username,
  relayUrl,
  onBack,
  onJoined,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onJoined: (duplicateCount: number) => void;
}) {
  const sync = useSync();
  const core = useCore();
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [hasLocalData, setHasLocalData] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [recovering, setRecovering] = useState(false);

  if (recovering) {
    return (
      <RecoverStep
        username={username}
        relayUrl={relayUrl}
        onBack={() => setRecovering(false)}
        onJoined={onJoined}
      />
    );
  }

  function onSubmit() {
    setError(null);
    if (password === "") {
      setError("Password is required.");
      return;
    }
    // Find out whether this device has local data to reconcile, so the
    // confirmation can be honest. Treat a read failure as "might have data".
    setHasLocalData(null);
    void core.views
      .entityList()
      .then((rows) => setHasLocalData(rows.length > 0))
      .catch(() => setHasLocalData(true));
    setConfirming(true);
  }

  async function login() {
    setError(null);
    setWorking(true);
    try {
      const { duplicateCount } = await sync.join({
        username,
        password,
        relayUrl,
      });
      onJoined(duplicateCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't log in.");
      setWorking(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <View style={styles.section}>
        <Text style={styles.fieldValue}>Log in as “{username}”?</Text>
        {hasLocalData === null ? (
          <Text style={styles.muted}>Checking this device…</Text>
        ) : hasLocalData ? (
          <Text style={styles.muted}>
            This device already has data. Logging in to “{username}” keeps it
            and combines it with the account's data; any people that look like
            duplicates are flagged for you to review and merge.
          </Text>
        ) : (
          <Text style={styles.muted}>
            Log in to “{username}” on {relayUrl} and sync this device.
          </Text>
        )}
        <Pressable
          style={styles.button}
          disabled={working || hasLocalData === null}
          onPress={login}
        >
          <Text style={styles.buttonText}>
            {working ? "Logging in…" : "Log in"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          disabled={working}
          onPress={() => setConfirming(false)}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.fieldValue}>Log in as “{username}”</Text>
      <Text style={styles.muted}>
        Account “{username}” exists on {relayUrl}. Enter its password to log in
        and sync this device.
      </Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
      </View>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable style={styles.button} onPress={onSubmit}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        onPress={onBack}
      >
        <Text style={styles.buttonText}>Back</Text>
      </Pressable>
      <Pressable onPress={() => setRecovering(true)}>
        <Text style={styles.link}>
          Forgot your password? Recover with your recovery phrase
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Forgot-password recovery branch (model.md §6): the account exists but the user
 * lost the password. They enter their recovery phrase and choose a new password;
 * the master key is recovered from the relay's escrow and the password reset.
 */
function RecoverStep({
  username,
  relayUrl,
  onBack,
  onJoined,
}: {
  username: string;
  relayUrl: string;
  onBack: () => void;
  onJoined: (duplicateCount: number) => void;
}) {
  const sync = useSync();
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onSubmit() {
    setError(null);
    if (recoveryPhrase.trim() === "") {
      setError("Enter your recovery phrase.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setWorking(true);
    try {
      const { duplicateCount } = await sync.recover({
        username,
        recoveryPhrase,
        newPassword: password,
        relayUrl,
      });
      onJoined(duplicateCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't recover.");
      setWorking(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.fieldValue}>Recover “{username}”</Text>
      <Text style={styles.muted}>
        Enter your recovery phrase to recover “{username}” on {relayUrl} and
        choose a new password. Your old password can't be recovered — this
        replaces it.
      </Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Recovery phrase</Text>
        <TextInput
          style={[styles.input, { minHeight: 72 }]}
          value={recoveryPhrase}
          onChangeText={setRecoveryPhrase}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>New password</Text>
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
        <Text style={styles.fieldLabel}>Confirm new password</Text>
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
      <Pressable style={styles.button} disabled={working} onPress={onSubmit}>
        <Text style={styles.buttonText}>
          {working ? "Recovering…" : "Recover"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        disabled={working}
        onPress={onBack}
      >
        <Text style={styles.buttonText}>Back</Text>
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
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Save your recovery phrase</Text>
      <Text style={styles.muted}>
        This is shown once. Write it down or store it in a password manager.
        It's the only way back into your data if you lose your password — if you
        lose both, your data cannot be recovered.
      </Text>
      <RecoveryPhraseWords phrase={recoveryKey} />
      <View style={[styles.rowMeta, { marginTop: 0 }]}>
        <Text style={styles.fieldValue}>I've saved my recovery phrase</Text>
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

/** The numbered word grid + a copy button — shared by the one-time reveal and
 *  the on-demand "Reveal recovery phrase" section. */
function RecoveryPhraseWords({ phrase }: { phrase: string }) {
  const [copied, setCopied] = useState(false);
  const words = phrase.split(" ");

  async function copy() {
    await Clipboard.setStringAsync(phrase);
    setCopied(true);
  }

  return (
    <>
      <View
        style={[
          styles.input,
          { flexDirection: "row", flexWrap: "wrap", rowGap: 4 },
        ]}
      >
        {words.map((word, i) => (
          <Text
            key={`${i}-${word}`}
            selectable
            style={{ width: "33%", fontFamily: "Courier", color: colors.text }}
          >
            {i + 1}. {word}
          </Text>
        ))}
      </View>
      <Pressable style={styles.button} onPress={copy}>
        <Text style={styles.buttonText}>{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
    </>
  );
}

/**
 * On-demand recovery-phrase reveal, available whether or not sync is on (the
 * phrase also unlocks the local file if this device's key is ever lost —
 * `model.md` §6). Hidden behind a button so the words aren't shown unprompted.
 */
function RecoveryPhraseSection() {
  const sync = useSync();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setError(null);
    try {
      setPhrase(await sync.revealRecoveryPhrase());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't read the phrase.",
      );
    }
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Recovery phrase</Text>
      <Text style={styles.muted}>
        Your recovery phrase is the way back into your data if you lose your
        password or this device's secure storage is reset.
      </Text>
      {phrase === null ? (
        <Pressable style={styles.button} onPress={reveal}>
          <Text style={styles.buttonText}>Reveal recovery phrase</Text>
        </Pressable>
      ) : (
        <>
          <RecoveryPhraseWords phrase={phrase} />
          <Pressable style={styles.button} onPress={() => setPhrase(null)}>
            <Text style={styles.buttonText}>Hide</Text>
          </Pressable>
        </>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}
