import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { useAccount } from "../lib/core-context";
import { PasswordInput } from "../components/PasswordInput";
import {
  CreateAccountForm,
  RecoveryKeyReveal,
} from "../components/ProtectData";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";
import { Button } from "../components/Button";

const NOT_CONFIRMED = "Not confirmed yet";
const PASSWORD_FIRST = "Enter your password to confirm.";

/**
 * The Account screen. The recovery phrase lives in local state only, so it
 * cannot survive a navigation, and goes once the user has saved it.
 */
export default function SettingsScreen() {
  const account = useAccount();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  // The phrase on screen for its one showing, from creation or rotation.
  const [revealed, setRevealed] = useState<string | null>(null);

  function refreshStatus() {
    void account.status().then(setStatus);
  }

  useEffect(refreshStatus, [account]);

  // The reveal takes over until acknowledged; each branch declares the title.
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
        {/* Only what needs an account; erasing data lives on Data. */}
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

/** Sign out, with no confirmation: the password reverses it. */
function SignOutSection() {
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    setError(null);
    // Not awaited: success unmounts this into the unlock gate, and only an
    // up-front refusal comes back here.
    account.signOut().catch((cause: unknown) => {
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
      <Button label="Sign out" onPress={signOut} />
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

/**
 * Replace the recovery phrase. Its copy must say it is no way back in: it
 * needs the password, and exists for a phrase that leaked.
 */
function RecoveryPhraseSection({
  onRotated,
}: {
  onRotated: (phrase: string) => void;
}) {
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (working) return;
    if (password === "") return showFormProblem(PASSWORD_FIRST, NOT_CONFIRMED);
    setError(null);
    setWorking(true);
    try {
      const { recoveryPhrase } = await account.rotateRecoveryPhrase(password);
      setPassword("");
      setConfirming(false);
      // The same one-time reveal account creation uses.
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
        <Button
          label="Replace recovery phrase…"
          onPress={() => setConfirming(true)}
        />
      ) : (
        <>
          <Text style={styles.muted}>
            Enter your password to confirm. (This isn't a way back in if you've
            forgotten it — the phrase is what covers that.)
          </Text>
          <Text style={styles.fieldLabel}>Password</Text>
          <PasswordInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            autoComplete="current-password"
          />
          <Button
            label={working ? "Replacing…" : "Replace phrase"}
            busy={working}
            faded={password === ""}
            onPress={() => void rotate()}
          />
          <Button
            label="Cancel"
            tone="secondary"
            busy={working}
            onPress={() => {
              setConfirming(false);
              setPassword("");
              setError(null);
            }}
          />
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
