import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { MIN_PASSWORD_LENGTH } from "@leapsake/core";
import { useSync } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/**
 * **Turning encryption on, and the one-time reveal that follows it** — the two
 * halves of custody Phase 0.5 (`encryption/model.md` §7.2.1) as reusable pieces.
 *
 * They lived inside `app/settings.tsx` until 2026-09-13 and moved here unchanged
 * when the **import** screen grew an offer to protect the device *before* bringing
 * an address book into it (`app/import.tsx`). Two screens now need the identical
 * flow, and duplicating a form that mints keys and shows a phrase exactly once is
 * the last thing worth copy-pasting: a divergence between the copies would be a
 * divergence in what the user's data is sealed under.
 *
 * **They stay a pair.** {@link CreateAccountForm} hands its caller a phrase and
 * nothing else; every caller owes the user {@link RecoveryKeyReveal} immediately
 * afterwards, because that phrase is never derivable again and is shown exactly
 * once (`model.md` §6.1). A caller that drops it on the floor has silently taken
 * the user's forgot-password backstop away.
 */

/**
 * A humble, dependency-free password hint. It does not score entropy (no
 * zxcvbn) — it enforces the length floor and steers toward a passphrase, which
 * is the guidance that actually helps for a key-deriving secret.
 *
 * Exported because the relay-bound signup step in `app/settings.tsx` shares it:
 * the same advice has to hold wherever a password becomes a key, and two copies
 * would be two different floors.
 */
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
 * relay-bound signup step in Settings — so a phone-only user who didn't want sync
 * had no way to encrypt their store at all, while a desktop user did.
 */
export function CreateAccountForm({
  onCreated,
}: {
  onCreated: (phrase: string) => void;
}) {
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
 * The one-time recovery-key reveal. Irreversible: the key is never re-derivable,
 * so the user must save it and tick the acknowledgement before continuing.
 */
export function RecoveryKeyReveal({
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
