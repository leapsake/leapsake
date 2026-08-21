/**
 * `@leapsake/flags` — the release switches that hold a finished feature back
 * from a release without deleting it.
 *
 * A flag here is **launch configuration, not runtime state**: it is chosen
 * before the app opens and does not change while it runs. That is what makes a
 * module-level singleton the right shape, against this repo's usual habit of
 * injected ports — a flag is read at the leaves (a `ui` section, a `reminders`
 * step definition), and threading a boolean through `CoreApi` and every port
 * between here and there would be more plumbing than the feature it gates.
 *
 * Zero dependencies, deliberately: `ui`, `reminders`, `core`, and both clients
 * all read flags, and `ui` cannot import `core`. Only a leaf can serve all of
 * them, so nothing may be added here that pulls in a workspace package.
 *
 * ## Resolution order
 *
 * Three layers, last one wins:
 *
 * 1. {@link FLAG_DEFAULTS} — what ships. The only layer under version control.
 * 2. The **environment** layer ({@link setFlagOverrides}) — a developer running
 *    the app with the switch flipped for this launch.
 * 3. The **local** layer ({@link setLocalFlagOverrides}) — a per-device
 *    override that outlives a launch. Reserved for a future dev menu.
 *
 * They are separate layers rather than one merged map so that clearing the
 * local layer falls back to the environment and then to the default, which is
 * what "reset this toggle" has to mean in a dev menu.
 *
 * ## Reading the environment is the client's job
 *
 * Nothing here touches `process.env`. The three runtimes disagree about how a
 * variable reaches the code — Metro *textually* inlines `process.env.EXPO_PUBLIC_*`
 * and nothing else, so a shared reader would silently resolve to `undefined` on
 * mobile. Each entry point parses its own idiom with {@link parseFlagOverrides}
 * and calls {@link setFlagOverrides}; see each client's README.
 *
 * ## Not a security boundary
 *
 * A flag hides a product surface. `apps/server` still answers relay requests,
 * and a build whose flag got flipped would sync perfectly well. Anything that
 * must be *enforced* belongs on the server, not here.
 */

/**
 * The shipping value of every flag — the list of flags, and the switch
 * positions a release is cut with.
 *
 * When a flag's feature ships, flip its default here, delete the flag, and
 * delete its gates in the same commit. There is no expiry metadata on purpose:
 * a field would only be as good as something enforcing it, and the removal is
 * tracked where the rest of the release's work is, in `plans/`.
 */
export const FLAG_DEFAULTS = {
  /**
   * Account-to-account sync — the whole multi-device story: signing in on a
   * second device, binding a local-only account to a relay, merging two stores,
   * and the background scheduler that keeps them converged.
   *
   * Held back to v0.2 *(owner, 2026-08-21)*. v0.1 ships single-device only, so
   * the code stays and the doors are shut. **This does not gate accounts** —
   * a local-only account is what turns encryption on, and that ships in v0.1
   * (`plans/encryption/model.md` §7.2.1). The line is the relay, not the login.
   */
  multiDevice: false,
} as const;

export type FlagName = keyof typeof FLAG_DEFAULTS;

export type FlagOverrides = Partial<Record<FlagName, boolean>>;

/** Every flag name, for error messages and for a dev menu to enumerate. */
export const FLAG_NAMES = Object.keys(FLAG_DEFAULTS) as readonly FlagName[];

let envOverrides: FlagOverrides = {};
let localOverrides: FlagOverrides = {};

/** Whether `name` is on, resolving local → environment → default. */
export function flag(name: FlagName): boolean {
  return localOverrides[name] ?? envOverrides[name] ?? FLAG_DEFAULTS[name];
}

/** Every flag's resolved value — for handing a whole set across a process
 *  boundary (desktop's preload bridge) or rendering a dev menu. */
export function flagSnapshot(): Record<FlagName, boolean> {
  return Object.fromEntries(
    FLAG_NAMES.map((name) => [name, flag(name)]),
  ) as Record<FlagName, boolean>;
}

/**
 * Replace the environment layer — called once, at a client's entry point,
 * before anything reads a flag.
 *
 * It *replaces* rather than merges so that a launch's set of overrides is
 * exactly what its environment said, with no residue from an earlier call.
 */
export function setFlagOverrides(overrides: FlagOverrides): void {
  envOverrides = { ...overrides };
}

/**
 * Replace the device-local layer — the seam a dev menu writes through after
 * reading whatever storage it keeps its toggles in.
 *
 * That storage is the client's to own, for the same reason environment parsing
 * is, plus two constraints worth writing down before anyone builds it: it must
 * **not** be the SQLite store, which is encrypted and unavailable until custody
 * unlocks while flags are read before that; and it must **not** be a syncable
 * table, because a dev toggle replicating to another device is a bug, not a
 * feature.
 *
 * A toggle should also **reload the app** rather than re-render it. Flags gate
 * things a live session has already acted on — the sync scheduler is started
 * once at boot — so flipping one mid-session leaves the app half-converted.
 * Reloading is why nothing here needs to be observable.
 */
export function setLocalFlagOverrides(overrides: FlagOverrides): void {
  localOverrides = { ...overrides };
}

/** Drop both override layers, leaving {@link FLAG_DEFAULTS}. For test teardown. */
export function resetFlagOverrides(): void {
  envOverrides = {};
  localOverrides = {};
}

/**
 * Parse an override spec — `"multiDevice"`, `"multiDevice=false"`, or several
 * separated by commas or whitespace — into overrides. `undefined` or an empty
 * spec yields no overrides, so an unset variable is not a special case at the
 * call site.
 *
 * **An unknown name throws.** A misspelled flag that quietly does nothing is
 * the whole failure mode of a dev switch: you conclude the feature is broken
 * when the switch never moved. Every caller is a dev-only path, so failing
 * loudly at boot with the valid names in hand is the cheaper outcome.
 */
export function parseFlagOverrides(spec: string | undefined): FlagOverrides {
  const overrides: FlagOverrides = {};
  for (const entry of (spec ?? "")
    .split(/[,\s]+/)
    .filter((s) => s.length > 0)) {
    const [name, value = "true"] = entry.split("=", 2);
    if (!isFlagName(name)) {
      throw new Error(
        `Unknown feature flag ${JSON.stringify(name)}. Known flags: ${FLAG_NAMES.join(", ")}.`,
      );
    }
    if (value !== "true" && value !== "false") {
      throw new Error(
        `Feature flag ${name} must be "true" or "false", got ${JSON.stringify(value)}.`,
      );
    }
    overrides[name] = value === "true";
  }
  return overrides;
}

function isFlagName(name: string | undefined): name is FlagName {
  return name !== undefined && name in FLAG_DEFAULTS;
}

/**
 * Run `run` with `overrides` applied to the local layer, restoring it after —
 * how a test exercises the *on* side of a flag whose shipping default is off.
 *
 * Always `await` it: the restore happens when `run`'s result settles, so a
 * promise dropped on the floor would outlive its own overrides.
 */
export async function withFlags<T>(
  overrides: FlagOverrides,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = localOverrides;
  localOverrides = { ...previous, ...overrides };
  try {
    return await run();
  } finally {
    localOverrides = previous;
  }
}
