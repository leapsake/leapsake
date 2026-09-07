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
import { Link, Stack } from "expo-router";
import { MIN_PASSWORD_LENGTH, type SyncStatus } from "@leapsake/core";
import { flag } from "@leapsake/flags";
import { useCore, useCustodyDegraded, useSync } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

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
 * Settings screen, titled "Account" here since the Settings tab is this
 * client's own overflow menu, not this screen. Deliberately a *stateful*
 * screen, not a router loader: the recovery key is shown exactly once and must
 * not survive a navigation or a re-run, so it lives in local state and is
 * dropped the moment the user confirms they've saved it.
 *
 * Device-to-device sync is real now: a first
 * device sets a password + username and registers with a relay; a second device
 * logs in to the same account; "Sync now" pushes/pulls the encrypted records.
 *
 * A root-stack screen reached from the Settings tab (and from Home's "Get
 * started" onboarding nudge, which deep-links straight here). It sets its own
 * header title, which the tab navigator used to.
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

  // The screen used to repeat its own name as an in-body <h1> under the header
  // that already says it. The header carries it alone now, including the wording
  // that used to live in the body: it names sync only when there is sync to name
  // — with `multiDevice` held back the word would be the only place a v0.1 user
  // meets the idea, and it would go nowhere.
  const title = flag("multiDevice") ? "Account & sync" : "Account";

  // One-time reveal takes over the screen until acknowledged. It keeps the same
  // header title as the screen it took over, so each branch declares it — the
  // shape holidays/[id] uses for its own two branches.
  if (revealed !== null) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <RecoveryKeyReveal
          recoveryKey={revealed.phrase}
          escrowPending={revealed.escrowPending}
          onDone={() => {
            setRevealed(null);
            refreshStatus();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.screen}>
        {status === null ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : status.hasAccount ? (
          <AccountEnabled
            status={status}
            reviewCount={reviewCount}
            onReviewed={() => setReviewCount(0)}
            onMerged={onJoined}
          />
        ) : (
          <>
            <CreateAccount
              onCreated={(phrase) =>
                setRevealed({ phrase, escrowPending: false })
              }
            />
            {/*
              Creating an account stays — it is what turns encryption on, and it
              is entirely local. Only the relay half is held back.
            */}
            {flag("multiDevice") && (
              <SyncSetup
                onEnabled={(phrase) =>
                  setRevealed({ phrase, escrowPending: false })
                }
                onJoined={onJoined}
              />
            )}
          </>
        )}
        {/*
          Getting rid of what is on this device lives on Settings > Data (app/data.tsx)
          rather than here: it is the same act whether or not an account holds the
          data, and this screen is about the account itself. What stays is what
          only makes sense with one — replacing the recovery phrase, and signing
          out of it.
        */}
        {status !== null && status.hasAccount && (
          <>
            <RecoveryPhraseSection onRotated={setRevealed} />
            <SignOutSection />
          </>
        )}
      </ScrollView>
    </>
  );
}

/** Shown once sync is enabled: the account exists; sync runs on demand. */
function AccountEnabled({
  status,
  reviewCount,
  onReviewed,
  onMerged,
}: {
  status: SyncStatus;
  reviewCount: number;
  onReviewed: () => void;
  /** A merge landed: same shape as a join, because it ends in the same place. */
  onMerged: (duplicateCount: number) => void;
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
      {/*
        `multiDevice` off takes this branch whatever the account holds: a store
        that got relay-bound while the flag was on is a developer-only state, and
        showing sync controls in a build with no way to reach them would be the
        worse half of the trade. The copy below is written for a local-only
        account and reads as a small lie in that one state.
      */}
      {status.relayUrl === undefined || !flag("multiDevice") ? (
        <>
          <Text style={styles.muted}>
            This account is on this device only. Nothing is sent anywhere, so
            nothing here needs syncing.
          </Text>
          {/*
            The two ways out of a local-only account, and between them the reason
            it is not a trap (@leapsake/key-custody).

            They are siblings rather than one flow because they answer opposite
            questions — *publish the account that is already here* versus *move
            this data into one that exists elsewhere* — and a user knows which of
            those they want before they know any of the mechanics. The 409 fork
            inside `StartSyncing` is what carries the person who guessed wrong
            across to the other one.

            Both are relay work, so both wait for `multiDevice`. What is left
            without them is the true statement that this account is local, which
            is the whole of what v0.1 has to say here.
          */}
          {flag("multiDevice") && (
            <>
              <StartSyncing
                username={status.username}
                onBound={() => onMerged(0)}
                onMerged={onMerged}
              />
              <MergeSetup username={status.username} onMerged={onMerged} />
            </>
          )}
        </>
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
 * mobile mirror of desktop's `CreateAccount`. The copy is a tightened version of
 * desktop's (two paragraphs down to one, *owner, 2026-08-21*) rather than a
 * different message — both points below still have to survive the trim:
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
        A username and password encrypt your Leapsake data on this phone —
        nothing is sent anywhere. They protect access to your data, not the data
        itself: if this phone is lost or breaks, only a backup brings it back.
      </Text>
      {/*
        `testID`s here are load-bearing for the harness, not decoration. Both
        password fields are `secureTextEntry` with identical (empty) accessibility
        text, so a driver has nothing to tell them apart by and taps on the confirm
        field silently landed elsewhere — the wall slices 8 and 9 both hit. An
        explicit id is the anchor set the crucial-flow catalog grows "as flows
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
  merge = false,
  onBack,
  onJoined,
}: {
  username: string;
  relayUrl: string;
  /** Merge this device's local-only account in, rather than join from scratch. */
  merge?: boolean;
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
      const { duplicateCount } = await (merge ? sync.merge : sync.join)({
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
        {/*
          The merge's one genuinely non-mechanical part. After it lands the store
          opens under the *account's* password, and joining replaces this device's
          recovery key with the account's — so both doors this phone has today
          stop working. Unlike a fresh join, the user is giving up credentials
          that currently work, so it has to be said before, not discovered after.
          A warning and not a hoop: no re-typing, no phrase re-entry, because the
          people most likely to be here are the least likely to get through one.
        */}
        {merge && (
          <Text style={styles.muted}>
            This phone's password will stop working. From now on it opens with “
            {username}”'s password, and “{username}”'s recovery phrase replaces
            the one this phone has now. Make sure you have them before you
            continue. This cannot be undone.
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
      {/*
        Not offered on the merge route. Recovery carries the same "this device is
        already part of an account" refusal that made the merge flow necessary in
        the first place, so there is no merge-by-phrase path built (owner,
        2026-08-08: password-only for this increment). A button that can only
        throw is worse than one that isn't there.
      */}
      {!merge && (
        <Pressable onPress={() => setRecovering(true)}>
          <Text style={styles.link}>
            Forgot your password? Recover with your recovery phrase
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * **Start syncing an account that already exists on this device** — binding a
 * relay to a local-only account (`model.md` §7.2,
 * `encryption/model.md` §7.2.2), and the mobile mirror of
 * desktop's `StartSyncing`.
 *
 * No password field, and that is not an omission: binding publishes the
 * `wrap(MK, KEK)` the account already holds, so there is nothing to re-derive.
 * Asking for a password here would imply something is being re-established, and
 * nothing is — the same phrase and the same password keep working.
 *
 * ### The collision is the whole reason this is not a one-shot form
 *
 * The username was chosen with no relay in sight, so it may already belong to
 * someone. That `409` hides **two readings that want opposite outcomes**, and
 * only the user can tell them apart:
 *
 * - *"That is my own account, from my other device"* → merge into it, keeping
 *   this phone's data ({@link LoginStep} in its `merge` variant, reached without
 *   a second lookup — a 409 already proves the account is there).
 * - *"That is a stranger"* → pick another handle and bind again. There is no
 *   rename primitive because nothing was ever published; the retry *is* the
 *   rename.
 *
 * Guessing on the user's behalf is the one thing this must not do. Joining a
 * stranger's account would hand them your data, and refusing outright would
 * strand the person whose own account it is.
 */
function StartSyncing({
  username: localUsername,
  onBound,
  onMerged,
}: {
  /** This account's local username — the handle it will try to claim. */
  username: string | undefined;
  onBound: () => void;
  onMerged: (duplicateCount: number) => void;
}) {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(localUsername ?? "");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  // The handle the relay refused, which is what raises the fork below. Null
  // whenever there is no unresolved collision on screen.
  const [taken, setTaken] = useState<string | null>(null);
  // Set once the user says the taken handle is their own account: hands off to
  // the merge, which needs no lookup — the 409 was the existence proof.
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (merging) {
    return (
      <LoginStep
        username={taken ?? username}
        relayUrl={relayUrl}
        merge
        onBack={() => setMerging(false)}
        onJoined={onMerged}
      />
    );
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={styles.link}>
          Start syncing this account to your other devices
        </Text>
      </Pressable>
    );
  }

  async function onSubmit() {
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "") {
      setError("Username and relay URL are required.");
      return;
    }
    setBusy(true);
    try {
      const result = await sync.bindRelay({ username, relayUrl });
      if (result.status === "username-taken") setTaken(result.username);
      else onBound();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't reach the relay.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (taken !== null) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          “{taken}” is already taken on {relayUrl}
        </Text>
        <Text style={styles.muted}>
          Someone already syncs under that name. If that someone is you — an
          account you set up on another device — you can log in to it and bring
          this phone's data along. Otherwise pick a different name for this
          account.
        </Text>
        <Pressable style={styles.button} onPress={() => setMerging(true)}>
          <Text style={styles.buttonText}>
            That's my account — log in and bring this data with me
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.border }]}
          onPress={() => {
            setTaken(null);
            setError(null);
          }}
        >
          <Text style={styles.buttonText}>
            Someone else has it — pick a different name
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Start syncing this account</Text>
      <Text style={styles.muted}>
        Your account and everything in it stays exactly as it is — the same
        password opens it, and the recovery phrase you saved still works. This
        only publishes it to a relay so your other devices can log in.
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
      <Pressable
        style={styles.button}
        disabled={busy}
        onPress={() => void onSubmit()}
      >
        <Text style={styles.buttonText}>
          {busy ? "Starting…" : "Start syncing"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        disabled={busy}
        onPress={() => setOpen(false)}
      >
        <Text style={styles.buttonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/**
 * **Merging a local-only account into a synced one** — {@link SyncSetup}'s
 * counterpart for a device that already *has* an account
 * (`encryption/model.md` §7.2.2), and the mobile mirror of desktop's
 * `MergeSetup`.
 *
 * A sibling rather than a branch of `SyncSetup`, because one thing it must never
 * do is offer to create a *second* account: this device already has one, and
 * making another is precisely the mistake this flow exists to undo. A username
 * the relay does not know is therefore a dead end here, not a sign-up.
 *
 * It lives inside {@link AccountEnabled}, so it unmounts on its own once the
 * merge lands and the account gains a relay.
 */
function MergeSetup({
  username: localUsername,
  onMerged,
}: {
  /** This device's current (local-only) username, shown to keep the two apart. */
  username: string | undefined;
  onMerged: (duplicateCount: number) => void;
}) {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [resolved, setResolved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={styles.link}>
          Already have an account on another device? Log in and bring this data
          with you
        </Text>
      </Pressable>
    );
  }

  if (resolved) {
    return (
      <LoginStep
        username={username}
        relayUrl={relayUrl}
        merge
        onBack={() => {
          setResolved(false);
          setError(null);
        }}
        onJoined={onMerged}
      />
    );
  }

  async function onContinue() {
    setError(null);
    if (username.trim() === "" || relayUrl.trim() === "") {
      setError("Username and relay URL are required.");
      return;
    }
    setChecking(true);
    try {
      if (await sync.lookup(username, relayUrl)) setResolved(true);
      else {
        setError(
          `No account called “${username}” on ${relayUrl}. This phone already ` +
            "has an account, so there is nothing to create here — check the " +
            "username you used on your other device.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't reach the relay.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        Log in to an account you already have
      </Text>
      <Text style={styles.muted}>
        Everything on this phone moves into that account and keeps syncing from
        there.
        {localUsername !== undefined &&
          ` The local account ${localUsername} is retired in the process.`}
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
      <Pressable
        style={styles.button}
        disabled={checking}
        onPress={() => void onContinue()}
      >
        <Text style={styles.buttonText}>
          {checking ? "Checking…" : "Continue"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.button, { backgroundColor: colors.border }]}
        onPress={() => setOpen(false)}
      >
        <Text style={styles.buttonText}>Cancel</Text>
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
        {/*
          A `Switch` carries no text of its own, and the label beside it belongs to a
          sibling `Text` — so a driver has only geometry to find it by, and a relative
          selector picked the wrong element outright, leaving Done disabled and the
          failure two steps away. The same reason the account fields above carry ids.
        */}
        <Switch
          testID="recovery-acknowledged"
          value={acknowledged}
          onValueChange={setAcknowledged}
        />
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
