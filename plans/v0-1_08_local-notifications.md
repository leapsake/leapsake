# 08 — Local notifications (mobile)

> **Delivers:** a mobile user can be told about a reminder without opening the app — off by
> default, a daily digest when on, one-per-reminder if they choose. No server, no push tokens,
> nothing leaves the device. **Prerequisite for [`04`](./v0-1_04_mobile-pipeline.md)**: it adds
> native permissions and a config plugin, and 04 is where the first store build and listing are
> cut.

**Why it gates v0.1** *(owner, 2026-08-14)*: every other way of reaching a user — email chief
among them — is out of scope for v0.1. A reminders app whose reminders cannot reach you outside
the app is not shippable. This is the one deliberate exception to
[`v0-1.md`](./v0-1.md)'s *"v0.1 is not feature work"* rule.

## It is not push, and that is the point

Push means APNs/FCM, which means a server holding device tokens — the exact thing
[`../AGENTS.md`](../AGENTS.md) → *Product posture* forbids. What ships instead is **locally
scheduled notifications**: the app hands the OS a set of future alerts, the OS delivers them
whether or not the app is running. Indistinguishable from push to the user; no network at all.

`expo-notifications` is the one dependency. Local scheduling is unaffected by Expo Go's remote-push
restrictions, and the app already builds a dev client (`expo-dev-client`), so there is no Expo Go
path to care about.

## The shape: a second reconcile behind the first

The hard problem is already solved. `regenerateSystemReminders`
([`@leapsake/reminders`](../packages/reminders/README.md)) computes the desired reminder set for
today and reconciles the store to it — idempotently, tombstone-respectingly — at boot, on
foreground, and after every milestone write. `dueDate` is already the *act on this day* date,
offset-adjusted by the staggered rules.

Notifications are **the same move, one layer out**: compute the desired set of pending OS
notifications, diff it against what is actually scheduled, cancel and schedule the delta. Same
trigger points, same idempotence. Completion, dismissal, snooze, milestone edits, and sync-pulled
changes therefore need no new plumbing — they already kick the reconcile.

⚠️ **Store what happened, never what to do next** (migration 28's rule, and it binds hardest
here). The OS pending set is **derived state**, rebuilt from reminder rows on every reconcile. Never
persist "the next digest fires on 15 August" — that bakes today's policy into rows you can no longer
reach.

## The horizon is 30 days, and that is what makes it cheap

iOS caps pending local notifications at **64 per app** and silently drops the rest, keeping the
soonest. That looks like the dominant constraint. It isn't, because of `isWithinWindow`: a system
reminder **does not exist in the store** until its due date is within `LEAD_DAYS` (30) of today.

So the planner reads reminder rows and nothing else, and its horizon is bounded at ~30 days by
construction:

| Mode | Pending entries over the horizon | Against a 64 cap |
|---|---|---|
| `digest` | ≤ 1 per day *with content* → ≤ 30 | never binds |
| `each` | 1 per due reminder → typically well under 30 | binds only in pathological months |

Two properties fall out of reading rows rather than re-projecting milestones:

- **Every notification points at a reminder that already exists**, so the tap-through target is
  always valid.
- **No duplicated engine logic.** The window, the staggered offsets, and the tombstone rules stay
  in one place.

The cost is the honest one: **a user who does not open Leapsake for 30 days goes dark.** Accepted
for v0.1 — the home screen *is* the reminder list, so the app is opened by the same habit the
feature serves. Projecting further by walking milestones directly is the v0.2 lever if that ever
proves wrong; it is deliberately not built now.

Budget the planner to **60**, not 64, so a stray notification from elsewhere in the app cannot push
a real one off the end. In `each` mode, take the soonest 60 and drop the tail.

## Where the policy lives — the part the requirement forces

The decision *(owner, 2026-08-14)*: the policy is **per-device**, but **editable from any device**.
Set the phone's policy from the laptop, and vice versa. That single sentence rules out the obvious
implementation (device-local `AsyncStorage`) and forces three things:

**1. A device identity that predates accounts.** `device` rows are account-gated
(`account_id NOT NULL REFERENCES account(id)`) and are minted only inside key-custody's session
creation. Under *encryption follows custody* an account-less user has no device row — but they must
still get notifications. So: **mint a local device id on first run, independent of any account**,
and have key-custody **adopt that same id** as `device.id` when an account is later created. A user
who turns notifications on and *then* creates an account keeps their settings, with no reconciliation
step.

**2. A synced, one-row-per-device settings table.** New `notification_settings`, PK = device id,
joining `syncableRepos` and its guard test. Every device may **write** any row; each device
**applies** only its own.

Conflict behaviour is benign: two devices editing *different* rows never collide, and two devices
racing on the *same* row is last-writer-wins — correct for a preference.

**3. The label is denormalized onto the settings row.** The cross-device UI has to name the devices
it lists ("iPhone · Digest"), and `device` does not sync — deliberately, as account-identity, with
its replication designed with the relay later. Dragging it into the allowlist for a display string
would breach an invariant documented since migration 14. Instead the settings row carries its own
`label` and `platform`, making the table self-describing and leaving the zero-knowledge boundary
untouched.

A device therefore appears in the list exactly when it has written a row — i.e. when it has a
notification policy. That is the right list, and it needs no extra machinery.

### Migration 29 — `notification_settings`

| Column | Meaning |
|---|---|
| `device_id` | PK. The first-run local id (§1), adopted by `device.id` on account creation |
| `label`, `platform` | Denormalized for the cross-device UI (§3) |
| `mode` | `off` \| `digest` \| `each`. **Default `off`** |
| `delivery_minute` | Minutes past local midnight. Default `540` (09:00). An integer, not a time string — portable and directly comparable |
| `permission_state` | Last known OS permission, written **only by the owning device** |
| *substrate* | `created_at`, `updated_at`, `deleted_at` per §4.2 |

**`permission_state` is a consequence of the cross-device requirement, not a nicety.** You can turn
your phone's notifications on from your laptop, and the phone may not have OS permission. Without
this column the laptop's UI would confidently lie. It is a fact about what happened, so it does not
violate the rule above.

**Deliberately absent: the privacy level.** Owner has it as a future want; for now notification text
carries full context and trusts the OS's own preview setting. Adding a `privacy` column later is a
cheap migration and guessing its shape now is not — the same reasoning migration 28 applied to its
missing owner column.

## Modes, and what actually differs

Defaults *(owner, 2026-08-14)*: **off** on a new install; when a user turns notifications on,
**digest** is what they get unless they pick `each`.

Be honest in the copy about what `each` buys. Every reminder due on a given day fires at the same
`delivery_minute` in either mode, so `each` is not more timely — it is *digest, exploded, with a tap
target per item*. That framing keeps the surface to one three-way control plus a time picker and
resists the pull toward per-reminder toggles.

The governing principle: **the per-milestone schedule already chose *what* you are reminded about.
This setting only chooses *how it reaches you*.**

Digest text is computed at schedule time — the reminder set is deterministic, so each day's count and
lead names are baked into that day's entry, and **only days with content are scheduled** (no "you
have 0 reminders" banner). It goes stale if data changes; the foreground reconcile fixes it.

**A reminder notifies iff** it has a non-null `dueDate`, is not completed, is not currently snoozed
(`snoozed_until`), is not soft-deleted, and `onboardingRouteOf(id) === null`. Onboarding nudges are
dateless product prompts — a *"connect sync"* banner at 09:00 would be obnoxious.

## The increments

**Inc 1 — the policy substrate.** First-run device id + key-custody adoption; migration 29; the
repo; the allowlist entry and its guard test; core read/write methods. No UI, no OS calls. Ships
invisible.

**Inc 2 — the planner.** New `@leapsake/notifications` — pure, injected ports, no
`@leapsake/core` dependency, per [`decompose-core`](../packages/core/README.md). Core is:
`planNotifications(reminders, policy, now) → DesiredNotification[]`, deterministic with `now` as a
parameter, plus a `reconcile(desired, pending, scheduler)` set-diff. The OS scheduler is a port —
which is exactly why this is not folded into `@leapsake/reminders`, and what lets desktop share it
later. Fully unit-testable with no device.

**Inc 3 — the mobile adapter and UI. In progress: §1, §2, §3, §4, §5, §6 done; §7 open.**
`expo-notifications` plugin and config; the Android channel; the permission flow; the port
implementation; the reconcile wired to the same boot / foreground / post-write triggers as
`regenerateSystem`; the settings section listing every device with a policy. Scoped in full below,
where each numbered item is marked done or open. **Next: §7**, the settings UI — the last item,
and the first real call site for both §4's permission flow and the mode/delivery-time policy
`core.notificationSettings.setPolicy` already supports.

### Inc 3, scoped

**New dependency: `expo-notifications`** (not currently in `apps/mobile/package.json`). No
`expo-device` — a device's label is `Platform.OS`-derived ("iPhone" / "Android phone"), not a
personalized name. A real device name is a cheap v0.2 lever if it's ever wanted; guessing at it
now buys nothing.

1. **Device id — done.** `ensureLocalDeviceId` (`packages/key-custody/src/session.ts:97`,
   re-exported from `@leapsake/core`) is minted once at boot in `core-context.tsx`, right after
   `secureStoreKeyStore()` is instantiated, into a `deviceId` ref alongside `coreRef`/`scheduler`.
   Its first-ever call site.

2. **Config plugin — done, but not the shape this doc originally assumed.** Added a bare
   `"expo-notifications"` entry to `app.json`'s `plugins` array (`apps/mobile/app.json:26`) — no
   config object, unlike the `expo-contacts` entry it sits next to. Checked against the installed
   package (`node_modules/expo-notifications/plugin/build/`): its plugin has no
   permission-message props at all (neither platform requires one — Android's `POST_NOTIFICATIONS`
   and iOS's request both show system-standard text, not an app-supplied string, unlike
   `NSContactsUsageDescription`), and its only channel-shaped prop, `defaultChannel`, just writes
   an id into an FCM meta-data tag — it doesn't create a channel. Channels are an OS object with no
   manifest-declaration path in Android at all; they only exist once something calls
   `setNotificationChannelAsync`. So "before first launch" isn't reachable through config the way
   this item assumed — the achievable version is "before first use," done in
   `notification-scheduler.ts` instead: a module-level `channelReady` promise created via
   `setNotificationChannelAsync("reminders", { name: "Reminders", importance: DEFAULT })`, awaited
   at the top of `schedule()`. `channelId: "reminders"` is now set on every `DATE` trigger (§3's
   "no channelId set yet" note is resolved).

3. **The port — done.** `expoNotificationScheduler()` (`apps/mobile/lib/notification-scheduler.ts`)
   implements `MobileNotificationScheduler`: `schedule` → `scheduleNotificationAsync` with a `DATE`
   trigger (`SchedulableTriggerInputTypes.DATE`) and `identifier: notification.id` — passing our own
   id rather than letting the OS mint one, so `cancel(id)` can find it again — `cancel` →
   `cancelScheduledNotificationAsync`, `listPending` wraps `getAllScheduledNotificationsAsync`. A
   `DATE` trigger is confirmed (via the installed package's own `.d.ts`) to echo its `date` field
   back verbatim rather than decomposing into iOS calendar components the way `CALENDAR` would, so
   `fireAt` round-trips exactly with no reconstruction. Instantiated once (stateless, so lazily at
   ref-creation rather than inside the boot effect) in `core-context.tsx`'s `notificationScheduler`
   ref. `channelId: "reminders"` is set on every `DATE` trigger, per §2's `channelReady` promise.

4. **Permission flow — the logic is done; its call site is §7.**
   `requestNotificationPermissionOnThisDevice` (`apps/mobile/lib/notification-permission.ts`)
   requests and persists in one call: injected ports (`requestPermission`,
   `setPermissionState`), mirroring `forget-account.ts`'s convention for OS-touching calls, so
   it's unit-tested (`notification-permission.test.ts`) without mocking `expo-notifications`.
   Always requests, never checks first — like `import.tsx`'s `readDeviceContacts`, this trusts
   the platform's own API to no-op a repeat ask once the user has answered. Returns
   `{ status, canAskAgain }`; persists `status` via
   `core.notificationSettings.setPermissionState(deviceId, state)` (the "only the owning device
   writes it" rule holds automatically, since this only ever fires from this device's own
   toggle). **Not wired to anything yet** — unlike §1/§3/§5/§6, this has no legitimate call site
   before §7 exists: it must fire exactly once, at the moment the settings mode picker leaves
   `off`, never at launch, so there's nothing to wire it to until that picker is built. §7 is
   where the real `Notifications.requestPermissionsAsync` call gets assembled (mirror
   `import.tsx:57-64`) and where `canAskAgain === false` decides between offering a retry and
   showing `import.tsx`'s denial pattern (`import.tsx:259-274`): explanatory text +
   `Linking.openSettings()` pressable.

5. **Reconcile — boot and foreground — done.** `reconcileNotifications` (`core-context.tsx`, next
   to `regenerateSystemReminders`) reads this device's policy, the reminder set, calls
   `planNotifications`, then `reconcile` — a no-op today since `notificationScheduler.current` is
   still `null` (§3). Called once at boot immediately after `regenerateSystemReminders` — after,
   not before, since this is "a second reconcile behind the first" — and once from the same
   `AppState === "active"` listener.

6. **Reconcile — post-write. Done, and mobile-only after all.** The original worry: `regenerateSystem()`
   runs *inside* `@leapsake/core`'s command handlers, invisible to mobile, and `createCore` takes
   no callback — so a naive fix would thread a new port through `packages/core`. Turned out
   unnecessary. `@leapsake/sync` already ships exactly this mechanism for its own purposes:
   `withSyncKick<T>(core, kick)` (`packages/sync/src/scheduler.ts:207`) wraps a `CoreApi`-shaped
   object so every method matching `MUTATING_METHOD` calls `kick` after it resolves, recursing
   into nested groups — mobile already wraps `bootedCore`/`joinedCore`/`recoveredCore` in it once,
   for sync. The fix is a **second layer**: `core-context.tsx`'s new `buildCore` helper wraps
   twice — the existing sync kick, then a notifications kick that calls the reconcile above with
   `coreRef.current`. Zero `@leapsake/core` changes; Inc 3 stays entirely under `apps/mobile` (plus
   one two-word regex edit below). This also folds in completion/snooze/dismissal for free —
   `reminders.setCompleted`/`snooze`/`softDelete` already match `MUTATING_METHOD`, so they were
   never the gap; only the *reconcile-recompute* trigger was missing, and this closes it uniformly.

   **One real pre-existing gap found and fixed along the way:** `notificationSettings.setPolicy`/
   `setPermissionState` (Inc 1) didn't match `MUTATING_METHOD`, so editing another device's policy
   waited for the sync backstop interval instead of pushing at once — exactly the cross-device
   responsiveness §4/§7 depend on. Added both names to the regex
   (`packages/sync/src/scheduler.ts:195`) and to `with-sync-kick.test.ts`'s pinned surface.

7. **Settings UI.** `apps/mobile/app/settings.tsx` is titled "Account & sync" and its
   `RecoveryPhraseSection`/`SignOutSection` are gated on `status.hasAccount` — but notification
   policy is pre-account by design (§1 above), so the new section renders **unconditionally**,
   placed after the account/sync block and before the `hasAccount`-gated pair. A three-way mode
   picker (`off`/`digest`/`each`) via the existing `SelectField` component
   (`apps/mobile/components/SelectField.tsx`); a delivery-time picker (`SelectField` in
   30-minute increments, unless that reads badly as a continuous value — try a native time
   picker instead if so); a read-only list of every *other* device with a policy row
   (`core.notificationSettings.list()` filtered to exclude this device), each showing
   `label · mode`. Editing another device's row calls the same `setPolicy(otherDeviceId, patch)`
   — no separate code path, since the repo methods already take an explicit `deviceId` rather
   than assuming "this device" (`packages/core/src/index.ts:1329-1353`).

**Not in Inc 3:** the desktop applier (out of 08 entirely, see *Scope* below); notification
privacy levels (deliberately deferred, see *Migration 29* above); a personalized device label
beyond `Platform.OS` (see dependency note above).

## Platform notes that bite

- **Ask for permission at opt-in, never at first launch.** iOS gives one shot; a denial is
  permanent until the user walks into Settings. On denial, show an *Open Settings* deep link rather
  than a dead toggle. Android 13+ needs runtime `POST_NOTIFICATIONS`, same treatment. This is the
  accessibility posture: no hoops before the user has asked for the thing.
- **Do not request Android exact alarms.** `SCHEDULE_EXACT_ALARM` is Play-restricted to
  alarm/calendar-class apps and gated harder on Android 14. Inexact delivery means "around 09:00,
  later if dozing," which is fine for a birthday digest and keeps a reviewable permission off the
  manifest. Worth knowing *before* 04 cuts the listing.
- **Time zones.** Compute the absolute fire time from the civil date + `delivery_minute` in the
  current zone at schedule time, and let the foreground reconcile correct drift after travel or a
  DST shift. Reuse the civil-date math in `schema/reminder-schedule.ts`; never raw `Date`
  arithmetic.

## Scope, and what this does *not* do

**Mobile only.** Desktop is kept in mind — the planner is platform-free and the settings table is
device-keyed precisely so an Electron applier drops in later — but no desktop work is in this unit.
A device with no row is `off`, so desktop simply does not appear in the list until it ships one.
Which means the cross-device affordance is **real but one-sided for v0.1**: mobile devices can
configure each other, and desktop joins when it joins.

**It does not enlarge [`06`](./v0-1_06_e2e-and-release-gate.md).** The planner is pure and covered by
unit tests; the adapter gets a manual smoke check on each platform. No new row in the E2E catalog —
06's sizing is already an open owner decision and this must not add to it.

## Done when

Delete this doc and its row in [`v0-1.md`](./v0-1.md) when: a fresh install notifies nobody; turning
notifications on in mobile settings asks for permission once and then delivers a 09:00 digest naming
that day's reminders; switching to `each` delivers one per reminder; completing or snoozing a
reminder before its fire time silences it; and a second phone's policy is visible and editable from
the first. Move the durable *why* — the 30-day horizon, the derived-state rule, the denormalized
label — into `@leapsake/notifications`'s `README.md`, not into another `plans/` file.
