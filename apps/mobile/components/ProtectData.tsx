import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { MIN_PASSWORD_LENGTH } from "@leapsake/core";
import { CheckboxBox } from "./Checkbox";
import { PasswordInput } from "./PasswordInput";
import { useAccount } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { colors, styles } from "../lib/styles";
import { Button } from "./Button";

const NOT_SAVED_YET = "Save your phrase first";
const SAVE_PHRASE_FIRST =
  "Write your recovery phrase down or copy it somewhere safe, then tick “I’ve saved my recovery phrase”.";

// Account creation and the one-time reveal, always a pair: a caller that
// skips the reveal has lost the user's only sight of their phrase.

/** The length floor, and a nudge toward a passphrase; no entropy score. */
export function passwordHint(password: string): string {
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
 * Create an account here, which turns encryption on; nothing is sent. Its
 * copy promises access, not safety: an account is no backup.
 */
export function CreateAccountForm({
  onCreated,
}: {
  onCreated: (phrase: string) => void;
}) {
  const account = useAccount();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (busy) return;
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
      const { recoveryKey } = await account.createAccount({
        username,
        password,
      });
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
      <Text style={styles.sectionTitle}>Encrypt your data</Text>
      <Text style={styles.muted}>
        A username and password encrypt your Leapsake data on this phone —
        nothing is sent anywhere. They protect access to your data, not the data
        itself: if this phone is lost or breaks, only a backup brings it back.
      </Text>
      {/* E2E anchors: two secure fields have identical, empty accessibility
          text (maestro/README.md). */}
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
        <PasswordInput
          testID="account-password"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {hint !== "" && <Text style={styles.muted}>{hint}</Text>}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Confirm password</Text>
        <PasswordInput
          testID="account-confirm-password"
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          autoComplete="new-password"
          textContentType="newPassword"
        />
      </View>
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        testID="account-submit"
        label={busy ? "Encrypting your data…" : "Encrypt my data"}
        busy={busy}
        onPress={() => void onSubmit()}
      />
    </View>
  );
}

/**
 * The one-time recovery-key reveal. The key is never derivable again, so the
 * user must tick that they saved it before continuing.
 */
export function RecoveryKeyReveal({
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
      {/* An id, since a driver must hit this row or Done stays disabled. */}
      <Pressable
        testID="recovery-acknowledged"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acknowledged }}
        accessibilityLabel="I've saved my recovery phrase"
        style={[styles.rowWithLead, { paddingVertical: 8 }]}
        onPress={() => setAcknowledged(!acknowledged)}
      >
        <CheckboxBox checked={acknowledged} />
        <Text style={styles.fieldValue}>I've saved my recovery phrase</Text>
      </Pressable>
      <Button
        label="Done"
        faded={!acknowledged}
        onPress={() =>
          acknowledged
            ? onDone()
            : showFormProblem(SAVE_PHRASE_FIRST, NOT_SAVED_YET)
        }
      />
    </ScrollView>
  );
}

/** The numbered word grid and a copy button, for the one-time reveal. */
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
      <Button label={copied ? "Copied" : "Copy"} onPress={() => void copy()} />
    </>
  );
}
