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
import { MIN_PASSWORD_LENGTH, type SyncStatus } from "@leapsake/core";
import { useCore, useCustodyDegraded, useSync } from "../../lib/core-context";
import { colors, styles } from "../../lib/styles";

/** Prefilled relay origin for local development (apps/server defaults to :4000). */
const DEFAULT_RELAY_URL = "http://localhost:4000";

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

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
  // The phrase currently on screen for its one-and-only showing — from account
  // creation, or from the rotation that replaced it. `escrowPending` is only ever
  // true for the latter (see {@link RecoveryPhraseSection}).
  const [revealed, setRevealed] = useState<{
    phrase: string;
    escrowPending: boolean;
  } | null>(null);
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
  if (revealed !== null) {
    return (
      <RecoveryKeyReveal
        recoveryKey={revealed.phrase}
        escrowPending={revealed.escrowPending}
        onDone={() => {
          setRevealed(null);
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
      ) : status.hasAccount ? (
        <AccountEnabled
          status={status}
          reviewCount={reviewCount}
          onReviewed={() => setReviewCount(0)}
        />
      ) : (
        <>
          <CreateAccount
            onCreated={(phrase) =>
              setRevealed({ phrase, escrowPending: false })
            }
          />
          <SyncSetup
            onEnabled={(phrase) =>
              setRevealed({ phrase, escrowPending: false })
            }
            onJoined={onJoined}
          />
        </>
      )}
      {/*
        The two ways to be rid of what is on this device, one per custody state
        (`model.md` §7.2), mirroring desktop. With an account, "Forget account"
        removes it and its store; without one there is nothing to forget, so the
        accountless wipe is the only shape the action can take. Showing both at
        once was showing one act twice — they land in the identical place.
      */}
      {status !== null &&
        (status.hasAccount ? (
          <>
            <RecoveryPhraseSection onRotated={setRevealed} />
            <SignOutSection />
            <ForgetAccountSection />
          </>
        ) : (
          <FactoryResetSection />
        ))}
    </ScrollView>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  reviewCount,
  onReviewed,
}: {
  status: SyncStatus;
  reviewCount: number;
  onReviewed: () => void;
}) {
  const sync = useSync();
  // Whether this device is *Degraded* — it holds the account but cannot prove the
  // account's master key, so it syncs nothing (custody slice 10).
  const degraded = useCustodyDegraded();
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Set when a sync 401s because the password was reset on another device — shows
  // the re-enter-password prompt below. Cleared on the next successful sync.
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
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
          setNeedsReauth(false);
        }
        if (payload.error !== undefined) setError(payload.error);
        if (payload.needsReauth === true) setNeedsReauth(true);
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

  async function reconnect() {
    if (reauthPassword.length === 0) return;
    setError(null);
    setReconnecting(true);
    try {
      await sync.reauthenticate(reauthPassword);
      setReauthPassword("");
      setNeedsReauth(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reconnect.");
    } finally {
      setReconnecting(false);
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
      {/*
        No relay means an account created locally (`sync.createAccount`), which
        is now reachable on this client too. It has nothing to sync to, so the
        sync controls are not shown rather than shown and failing: every one of
        them would have ended in "Sync is not enabled for this store."
      */}
      {status.relayUrl === undefined ? (
        <Text style={styles.muted}>
          This account is on this device only. Nothing is sent anywhere, so
          nothing here needs syncing.
        </Text>
      ) : degraded !== null ? (
        /*
          Degraded (custody slice 10): hidden for the same reason as on a relay-less
          account — every control would fail, and tapping "Sync now" to be told why
          is a worse way to learn it. The banner above carries the cause and the fix.
        */
        <Text style={styles.muted}>
          Sync is paused until this device is re-linked to your account — see
          the notice at the top of the screen.
        </Text>
      ) : (
        <>
          {autoSync !== null && (
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
        </>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {needsReauth && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>New password</Text>
          <TextInput
            style={styles.input}
            value={reauthPassword}
            onChangeText={setReauthPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />
          <Pressable
            style={styles.button}
            disabled={reconnecting || reauthPassword.length === 0}
            onPress={reconnect}
          >
            <Text style={styles.buttonText}>
              {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * **Create an account on this device** (`model.md` §7.2.1) — the act that turns
 * encryption on. Entirely local: no relay, no email, nothing transmitted. The
 * mobile mirror of desktop's `CreateAccount`, down to the copy, which is
 * load-bearing in two ways worth keeping identical across the clients:
 *
 * 1. **Promise access, not safety.** An account protects against *this device
 *    losing its security settings*; it does nothing about a lost or broken
 *    phone. Borrowing the user's SaaS instincts and then violating them on the
 *    worst day is the failure mode to avoid, so backups are named rather than
 *    implied.
 * 2. **"Account" is our vocabulary, not the user's.** A username and password
 *    that never leave the phone are *accountless* in every sense a user cares
 *    about. The heading softens the word; the mechanism is unchanged.
 *
 * Until this existed, mobile reached account creation only through the
 * relay-bound signup step below — so a phone-only user who didn't want sync had
 * no way to encrypt their store at all, while a desktop user did.
 */
function CreateAccount({ onCreated }: { onCreated: (phrase: string) => void }) {
  const sync = useSync();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (username.trim() === "") {
      setError("Choose a username.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { recoveryKey } = await sync.createAccount({ username, password });
      onCreated(recoveryKey);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't create the account.",
      );
      setBusy(false);
    }
  }

  const hint = passwordHint(password);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Protect your data</Text>
      <Text style={styles.muted}>
        Right now anyone who can unlock this phone can read your Leapsake data.
        Setting up a username and password encrypts it on this device.
      </Text>
      <Text style={styles.muted}>
        This stays on this phone — there's no email, no server, and nothing is
        sent anywhere. It protects access to your data, not the data itself: if
        this phone is lost or breaks, a password won't bring your data back. Set
        up sync or keep a backup for that.
      </Text>
      {/*
        `testID`s here are load-bearing for the harness, not decoration. Both
        password fields are `secureTextEntry` with identical (empty) accessibility
        text, so a driver has nothing to tell them apart by and taps on the confirm
        field silently landed elsewhere — the wall slices 8 and 9 both hit. An
        explicit id is the anchor set `launch.md` Increment 6 plans to add "as flows
        need them"; this flow needs them.
      */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Username</Text>
        <TextInput
          testID="account-username"
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoComplete="username"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Password</Text>
        <TextInput
          testID="account-password"
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
          testID="account-confirm-password"
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
      <Pressable
        testID="account-submit"
        style={[styles.button, busy && { opacity: 0.5 }]}
        disabled={busy}
        onPress={() => void onSubmit()}
      >
        <Text style={styles.buttonText}>
          {busy ? "Encrypting your data…" : "Protect my data"}
        </Text>
      </Pressable>
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
      {/* A heading only step 1 needs: it is what tells this apart from the
          local "Protect your data" section directly above. The steps it routes
          to name themselves. */}
      <Text style={styles.sectionTitle}>Sync across devices</Text>
      <Text style={styles.muted}>
        Enter a username and relay. We'll check whether that account exists,
        then help you create it or log in. This also encrypts this device.
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
  escrowPending,
  onDone,
}: {
  recoveryKey: string;
  /**
   * The rotation could not reach the relay, so the account's escrow still answers
   * to the *previous* phrase. Only ever true for a rotation — a new account has no
   * previous phrase, and a local-only account has no escrow.
   */
  escrowPending: boolean;
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
      {escrowPending && (
        <Text style={styles.danger} accessibilityRole="alert">
          Keep your old phrase until this device next syncs. Leapsake couldn't
          reach your relay, so recovering your account on a new device still
          needs the old phrase. This one takes over automatically the next time
          this device syncs.
        </Text>
      )}
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

/** The numbered word grid + a copy button — used by the one-time reveal, which
 *  since custody slice 8 is the *only* place a phrase is ever displayed (at
 *  account creation, and at the rotation that replaces it). */
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
 * **Sign out** (`model.md` §7.3) — the one action that reaches the Locked state
 * in v0.1, and the mobile mirror of desktop's.
 *
 * Two things it deliberately is not. Not a *Lock* button: Locked is a state, not
 * an affordance, and the app is meant to enter it on the user's behalf once idle
 * locking ships (v0.2). And not two behaviors sharing a name — the promise holds
 * whether or not the account is relay-bound (*nobody can see my data on this
 * device anymore*), so the copy never branches on it. That the encrypted bytes
 * remain is stated plainly, because it is the part a local-only user would
 * otherwise worry about.
 *
 * No confirmation step: it is reversible with the password, and gating it would
 * teach users to tap through the confirmations that *do* matter.
 */
function SignOutSection() {
  const sync = useSync();
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    setError(null);
    // Not awaited: the provider tears the core down and re-runs its bootstrap as
    // part of this call, so this screen unmounts into the unlock gate. A
    // rejection still lands here — it means the sign out was refused up front,
    // and the screen is still mounted.
    sync.signOut().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Couldn't sign out.");
    });
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Sign out</Text>
      <Text style={styles.muted}>
        Your data stays on this device, encrypted. You’ll need your password to
        get back in.
      </Text>
      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

/** The word a user must type to arm the (irreversible) account deletion. */
const FORGET_ACCOUNT_PHRASE = "DELETE";

/**
 * **Forget account** (`model.md` §7.3) — remove this account and its data from
 * this device. Named as removal so it can never be mistaken for signing out.
 *
 * The wording is **driven by a check, not hardcoded** (§7.3.1): the provider asks
 * the relay whether it keeps a durable copy and reports `durableBackup`. Absent an
 * answer — today's universal case, since no relay advertises the capability yet —
 * it is `false` and this shows the alarming version, hard-confirm and all. When
 * server-side backup ships, that copy stops appearing on its own.
 */
function ForgetAccountSection() {
  const sync = useSync();
  const [info, setInfo] = useState<{
    username?: string;
    relayUrl?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Read on entering the confirmation rather than on mount: it reaches out to
  // the relay, and there is no reason to do that for every visit to Settings.
  function beginConfirm() {
    setError(null);
    sync
      .forgetInfo()
      .then(setInfo)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't check this account.",
        );
      });
  }

  function cancel() {
    setInfo(null);
    setTyped("");
    setError(null);
  }

  // A relay that keeps a durable copy makes this ordinary — sign back in and
  // re-pull. Without one, the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await sync.forgetAccount();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove it.");
      setWorking(false);
    }
  }

  if (info === null) {
    return (
      <View style={{ marginTop: 24, gap: 8 }}>
        <Text style={styles.title}>Forget account</Text>
        <Text style={styles.muted}>
          Remove this account and everything in it from this device. This is not
          signing out — the data is deleted, not locked.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          onPress={beginConfirm}
        >
          <Text style={styles.buttonText}>Forget account…</Text>
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
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>
        {lastCopy ? "Delete all data on this device" : "Forget account"}
      </Text>
      <View style={styles.section}>
        {lastCopy ? (
          <>
            <Text style={styles.muted}>
              This permanently deletes everything in{" "}
              {info.username !== undefined
                ? `the account “${info.username}”`
                : "this account"}{" "}
              on this device.{" "}
              {info.relayUrl === undefined
                ? "This account is only on this device, so there is no other copy."
                : `${info.relayUrl} does not keep a backup of your data, so if this is your only device there is no other copy.`}
            </Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Type {FORGET_ACCOUNT_PHRASE} to confirm
              </Text>
              <TextInput
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          </>
        ) : (
          <Text style={styles.muted}>
            Remove{" "}
            {info.username !== undefined
              ? `“${info.username}”`
              : "this account"}{" "}
            from this device? {info.relayUrl} keeps a copy of your data, so you
            can sign back in to get it again.
          </Text>
        )}
        <Pressable
          style={[
            styles.button,
            lastCopy && { backgroundColor: colors.danger },
            (!armed || working) && { opacity: 0.5 },
          ]}
          disabled={!armed || working}
          onPress={forget}
        >
          <Text style={styles.buttonText}>
            {working
              ? "Removing…"
              : lastCopy
                ? "Delete all data"
                : "Forget account"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          disabled={working}
          onPress={cancel}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Factory reset: erase everything on this device and rebuild the app as a fresh
 * install.
 *
 * **Shown only while this device is Unauthenticated** (`model.md` §7.2) — with an account,
 * {@link ForgetAccountSection} is the same act under the name that fits, and
 * offering both was offering one act twice. That is also why the copy no longer
 * branches on whether sync is set up: an Unauthenticated device has no account, so this data
 * is by definition the only copy.
 *
 * Gated behind a type-to-confirm step (the danger-styled button stays disabled
 * until the user types {@link FACTORY_RESET_PHRASE}) because nothing about it is
 * recoverable. On success the provider rebuilds in place, so this screen unmounts
 * into a clean app — there is no completion state to render.
 */
function FactoryResetSection() {
  const sync = useSync();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const armed = typed.trim().toUpperCase() === FACTORY_RESET_PHRASE;

  async function reset() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await sync.factoryReset();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reset.");
      setWorking(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Factory reset</Text>
      <Text style={styles.muted}>
        Erase everything on this device and start over — all people, pets,
        reminders, and settings.
      </Text>
      {!confirming ? (
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          onPress={() => setConfirming(true)}
        >
          <Text style={styles.buttonText}>Factory reset…</Text>
        </Pressable>
      ) : (
        <View style={styles.section}>
          <Text style={styles.muted}>
            This permanently erases all data on this device. There is no account
            holding a copy, so this data cannot be recovered afterward.
          </Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Type {FACTORY_RESET_PHRASE} to confirm
            </Text>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <Pressable
            style={[
              styles.button,
              { backgroundColor: colors.danger },
              (!armed || working) && { opacity: 0.5 },
            ]}
            disabled={!armed || working}
            onPress={reset}
          >
            <Text style={styles.buttonText}>
              {working ? "Erasing…" : "Erase everything"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.border }]}
            disabled={working}
            onPress={cancel}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          {error !== null && (
            <Text style={styles.danger} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Replace the recovery phrase — **only rendered once an account exists**, and only
 * ever a *replacement*. It used to be a "Reveal recovery phrase" button; custody
 * slice 8 retired that (owner, 2026-07-28). The phrase is shown once at account
 * creation and never again, so this is the one later route to holding one.
 * Mirrors desktop's section, copy included.
 *
 * Two things the copy has to get right, because both are counter-intuitive:
 *
 * - **It is not a way back in.** It requires the password, and the phrase exists
 *   for when the password is gone. Its real job is compromise response — "my
 *   phrase leaked" — and someone arriving here after forgetting their password
 *   needs the unlock gate instead.
 * - **Other devices catch up on their own**, at their next sync, rather than
 *   instantly. Until then the old phrase still opens *their* local files.
 */
function RecoveryPhraseSection({
  onRotated,
}: {
  onRotated: (revealed: { phrase: string; escrowPending: boolean }) => void;
}) {
  const sync = useSync();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (password === "") return;
    setError(null);
    setWorking(true);
    try {
      const { recoveryPhrase, escrowPending } =
        await sync.rotateRecoveryPhrase(password);
      setPassword("");
      setConfirming(false);
      // Straight into the same one-time reveal account creation uses: this is the
      // only time these words are ever displayed.
      onRotated({ phrase: recoveryPhrase, escrowPending });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't replace the phrase.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Recovery phrase</Text>
      <Text style={styles.muted}>
        Your recovery phrase was shown once, when you created your account. It
        can't be shown again — if you saved it, keep it somewhere safe.
      </Text>
      <Text style={styles.muted}>
        If you've lost it, or think someone else has seen it, you can replace it
        with a new one. Your old phrase stops working.
      </Text>
      {!confirming ? (
        <Pressable style={styles.button} onPress={() => setConfirming(true)}>
          <Text style={styles.buttonText}>Replace recovery phrase…</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.muted}>
            Enter your password to confirm. (This isn't a way back in if you've
            forgotten it — the phrase is what covers that.)
          </Text>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Your password"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.muted}>
            Other devices on this account keep using the old phrase for their
            own files until they next sync, then switch over on their own.
          </Text>
          <Pressable
            style={[
              styles.button,
              (password === "" || working) && {
                backgroundColor: colors.border,
              },
            ]}
            disabled={password === "" || working}
            onPress={() => void rotate()}
          >
            <Text style={styles.buttonText}>
              {working ? "Replacing…" : "Replace phrase"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.border }]}
            disabled={working}
            onPress={() => {
              setConfirming(false);
              setPassword("");
              setError(null);
            }}
          >
            <Text style={styles.buttonText}>Cancel</Text>
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
