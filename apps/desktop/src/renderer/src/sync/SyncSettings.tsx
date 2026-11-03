import type { SyncStatus } from "@leapsake/core";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SyncActivityPayload, SyncResult } from "../../../preload";
import { SYNC_PREVIEW_MARKER } from "./preview";

const TEXT = {
  title: "Sync",
  back: "← Settings",
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
    "Already using Leapsake on another device that syncs? Sign in to bring this computer into the same account.",
  join: "Join",
  joining: "Joining…",
  usePhrase: "Forgot your password? Use your recovery phrase",
  usePassword: "Use your password instead",
  recover: "Recover",
  recovering: "Recovering…",
  startTitle: "Start syncing",
  startIntro:
    "Publish this computer's account to a relay, so other devices can join it. Your password and recovery phrase stay the same.",
  start: "Start syncing",
  starting: "Starting…",
  taken:
    "That username is already taken on this relay. Pick another, or, if it is your own account, merging arrives in a later preview.",
  syncingTitle: "Syncing",
  syncingAs: (username: string, relayUrl: string) =>
    `As ${username}, through ${relayUrl}.`,
  lastSynced: (at: number) =>
    `Last synced ${new Date(at).toLocaleTimeString()}.`,
  notSyncedYet: "Not synced yet since this window opened.",
  syncNow: "Sync now",
  syncingNow: "Syncing…",
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

/** What to show for a sync act that threw rather than resolving a reason. */
function thrown(cause: unknown): string {
  return cause instanceof Error ? cause.message : TEXT.failed;
}

/** A form's named field, as text. */
function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

/** The sync preview: join an account, publish this one, or show its sync. */
export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  function refresh() {
    void window.account.status().then(setStatus);
  }
  useEffect(refresh, []);

  return (
    <main id={SYNC_PREVIEW_MARKER}>
      <p>
        <Link to="/settings">{TEXT.back}</Link>
      </p>
      <h1>{TEXT.title}</h1>
      <p>{TEXT.preview}</p>
      {status === null ? (
        <p>{TEXT.loading}</p>
      ) : !status.hasAccount ? (
        <JoinForm onJoined={refresh} />
      ) : status.relayUrl === undefined ? (
        <StartSyncingForm status={status} onBound={refresh} />
      ) : (
        <SyncingPanel username={status.username} relayUrl={status.relayUrl} />
      )}
    </main>
  );
}

/** Runs a sync act, returning the copy for its failure, or `null`. */
async function attempt<T>(
  act: () => Promise<SyncResult<T>>,
  onDone: (value: T) => string | null,
): Promise<string | null> {
  try {
    const result = await act();
    return result.ok ? onDone(result.value) : TEXT.reasons[result.reason];
  } catch (cause) {
    return thrown(cause);
  }
}

function RelayField() {
  return (
    <p>
      <label>
        {TEXT.relayUrl}{" "}
        <input
          name="relayUrl"
          type="url"
          required
          placeholder={TEXT.relayUrlPlaceholder}
        />
      </label>
    </p>
  );
}

/** Join, or recover with the phrase; the app re-opens on the account. */
function JoinForm({ onJoined }: { onJoined: () => void }) {
  const sync = window.sync!;
  const [door, setDoor] = useState<"password" | "phrase">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const common = {
      relayUrl: field(form, "relayUrl").trim(),
      username: field(form, "username").trim(),
    };
    setError(null);
    setBusy(true);
    const failure = await attempt(
      () =>
        door === "password"
          ? sync.join({ ...common, password: field(form, "password") })
          : sync.recover({
              ...common,
              recoveryPhrase: field(form, "recoveryPhrase").trim(),
              newPassword: field(form, "newPassword"),
            }),
      () => {
        onJoined();
        return null;
      },
    );
    setError(failure);
    setBusy(false);
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
    <section>
      <h2>{TEXT.joinTitle}</h2>
      <p>{TEXT.joinIntro}</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <RelayField />
        <p>
          <label>
            {TEXT.username}{" "}
            <input name="username" required autoComplete="username" />
          </label>
        </p>
        {door === "password" ? (
          <p>
            <label>
              {TEXT.password}{" "}
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
          </p>
        ) : (
          <>
            <p>
              <label>
                {TEXT.recoveryPhrase}{" "}
                <textarea name="recoveryPhrase" required rows={3} cols={40} />
              </label>
            </p>
            <p>
              <label>
                {TEXT.newPassword}{" "}
                <input
                  name="newPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </label>
            </p>
          </>
        )}
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" aria-disabled={busy}>
          {submitLabel}
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            setDoor(door === "password" ? "phrase" : "password");
            setError(null);
          }}
        >
          {door === "password" ? TEXT.usePhrase : TEXT.usePassword}
        </button>
      </form>
    </section>
  );
}

/** Publish the account already here; a taken name is a question. */
function StartSyncingForm({
  status,
  onBound,
}: {
  status: SyncStatus;
  onBound: () => void;
}) {
  const sync = window.sync!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    const failure = await attempt(
      () =>
        sync.startSyncing({
          relayUrl: field(form, "relayUrl").trim(),
          username: field(form, "username").trim(),
        }),
      (result) => {
        if (result.status === "username-taken") return TEXT.taken;
        onBound();
        return null;
      },
    );
    setError(failure);
    setBusy(false);
  }

  return (
    <section>
      <h2>{TEXT.startTitle}</h2>
      <p>{TEXT.startIntro}</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <RelayField />
        <p>
          <label>
            {TEXT.username}{" "}
            <input
              name="username"
              required
              defaultValue={status.username ?? ""}
              autoComplete="username"
            />
          </label>
        </p>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" aria-disabled={busy}>
          {busy ? TEXT.starting : TEXT.start}
        </button>
      </form>
    </section>
  );
}

/** A relay-bound account: where it syncs, the last run, and a manual run. */
function SyncingPanel({
  username,
  relayUrl,
}: {
  username: string | undefined;
  relayUrl: string;
}) {
  const sync = window.sync!;
  const [last, setLast] = useState<SyncActivityPayload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => sync.onActivity(setLast), [sync]);

  async function syncNow() {
    if (busy) return;
    setBusy(true);
    await sync.syncNow();
    setBusy(false);
  }

  return (
    <section>
      <h2>{TEXT.syncingTitle}</h2>
      <p>{TEXT.syncingAs(username ?? "", relayUrl)}</p>
      <p>
        {last?.kind === "synced" ? TEXT.lastSynced(last.at) : TEXT.notSyncedYet}
      </p>
      {last?.kind === "failed" && (
        <p role="alert">{TEXT.reasons[last.reason]}</p>
      )}
      <button type="button" aria-disabled={busy} onClick={() => void syncNow()}>
        {busy ? TEXT.syncingNow : TEXT.syncNow}
      </button>
    </section>
  );
}
