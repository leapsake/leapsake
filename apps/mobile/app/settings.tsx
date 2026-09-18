import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { useSync } from "../lib/core-context";
import {
  CreateAccountForm,
  RecoveryKeyReveal,
} from "../components/ProtectData";
import { colors, styles } from "../lib/styles";

/**
 * Account setup (custody Phase 1/2) — the mobile mirror of desktop's Settings
 * screen, titled "Account" here since the Settings tab is this client's own
 * overflow menu, not this screen. Deliberately a *stateful* screen, not a router
 * loader: the recovery key is shown exactly once and must not survive a
 * navigation or a re-run, so it lives in local state and is dropped the moment
 * the user confirms they've saved it.
 *
 * A root-stack screen reached from the Settings tab (and from Home's "Get
 * started" onboarding nudge, which deep-links straight here). It sets its own
 * header title, which the tab navigator used to.
 */
export default function SettingsScreen() {
  const sync = useSync();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  // The phrase currently on screen for its one-and-only showing — from account
  // creation, or from the rotation that replaced it.
  const [revealed, setRevealed] = useState<string | null>(null);

  function refreshStatus() {
    void sync.status().then(setStatus);
  }

  useEffect(refreshStatus, [sync]);

  // One-time reveal takes over the screen until acknowledged. It keeps the same
  // header title as the screen it took over, so each branch declares it — the
  // shape holidays/[id] uses for its own two branches.
  if (revealed !== null) {
    return (
      <>
        <Stack.Screen options={{ title: "Account" }} />
        <RecoveryKeyReveal
          recoveryKey={revealed}
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
      <Stack.Screen options={{ title: "Account" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        {status === null ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : status.hasAccount ? (
          <AccountEnabled status={status} />
        ) : (
          <CreateAccountForm onCreated={setRevealed} />
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

/** Shown once this device has an account: what it is, and where it lives. */
function AccountEnabled({ status }: { status: SyncStatus }) {
  return (
    <View style={styles.section}>
      <Text style={styles.fieldValue}>Your account is set up.</Text>
      <Text style={styles.muted}>
        This device is protected by your password and recovery key.
        {status.username !== undefined && ` Username ${status.username}.`}{" "}
        Account created {new Date(status.createdAt ?? 0).toLocaleString()}.
      </Text>
      <Text style={styles.muted}>
        This account is on this device only. Nothing is sent anywhere, and
        nothing leaves this device.
      </Text>
    </View>
  );
}

/**
 * **Sign out** (`model.md` §7.3) — the one action that reaches the Locked state
 * in v0.1, and the mobile mirror of desktop's.
 *
 * Two things it deliberately is not. Not a *Lock* button: Locked is a state, not
 * an affordance, and the app is meant to enter it on the user's behalf once idle
 * locking ships (v0.2). And not two behaviors sharing a name — the promise is
 * *nobody can see my data on this device anymore*. That the encrypted bytes
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
 * ever a *replacement*. The phrase is shown once at account creation and never
 * again, so this is the one later route to holding one. Mirrors desktop's
 * section, copy included.
 *
 * The copy has to get this right, because it is counter-intuitive: **it is not a
 * way back in.** It requires the password, and the phrase exists for when the
 * password is gone. Its real job is compromise response — "my phrase leaked" —
 * and someone arriving here after forgetting their password needs the unlock
 * gate instead.
 */
function RecoveryPhraseSection({
  onRotated,
}: {
  onRotated: (phrase: string) => void;
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
      const { recoveryPhrase } = await sync.rotateRecoveryPhrase(password);
      setPassword("");
      setConfirming(false);
      // Straight into the same one-time reveal account creation uses: this is the
      // only time these words are ever displayed.
      onRotated(recoveryPhrase);
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
