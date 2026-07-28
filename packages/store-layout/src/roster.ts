/**
 * The on-device **account roster** (encryption `model.md` §7.4): which accounts
 * exist on this client. It is deliberately *not* a table in any store — you cannot
 * enumerate accounts from inside files you cannot decrypt — so it lives outside
 * every database, unencrypted, and is readable before anything is opened.
 *
 * It therefore leaks the usernames present on the device. The design accepts this
 * as unavoidable: a login picker has to render.
 *
 * Storage is injected because the two clients have unrelated persistence: desktop
 * writes a JSON file under `userData`, while mobile has no general filesystem
 * dependency (its recovery sidecar is an unencrypted SQLite database for the same
 * reason). Everything here is pure logic over that port.
 */

/** One account known to this device. */
export interface RosterEntry {
  /** Stable account id — also the store's directory name (`paths.ts`). */
  id: string;
  /** The login handle chosen at account creation (§7.2.1). */
  username: string;
  /** ISO-8601 creation timestamp, for a stable display order. */
  createdAt: string;
}

/** The persistence port: read and write one opaque text blob. */
export interface RosterStorage {
  /** The stored text, or `undefined` when nothing has been written yet. */
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

export interface AccountRoster {
  /** Every account on this device, oldest first. */
  list(): Promise<RosterEntry[]>;
  /** Add an account, or update the username of one already present. */
  add(entry: RosterEntry): Promise<void>;
  /** Remove an account (Forget account, §7.3). A no-op when absent. */
  remove(id: string): Promise<void>;
}

/** The on-disk shape. Versioned so a later migration has something to branch on. */
interface RosterFile {
  version: 1;
  accounts: RosterEntry[];
}

/**
 * Parse stored roster text, tolerating anything unreadable by returning an empty
 * roster.
 *
 * **Why tolerate rather than throw:** this file is read on the boot path, before
 * any UI exists to show an error. A corrupt roster must not brick the app into an
 * unlaunchable state — reporting "no accounts" degrades to the Open path, which is
 * recoverable, whereas a boot crash is not. The stores themselves are untouched
 * either way; only the *index* of them is lost.
 */
function parse(text: string | undefined): RosterEntry[] {
  if (text === undefined || text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as RosterFile).accounts)
    ) {
      return [];
    }
    // Keep only entries with the fields every consumer relies on; a partially
    // written array should surface the usable accounts, not none of them.
    return (parsed as RosterFile).accounts.filter(
      (entry): entry is RosterEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.id === "string" &&
        typeof entry.username === "string" &&
        typeof entry.createdAt === "string",
    );
  } catch {
    return [];
  }
}

export function createAccountRoster(storage: RosterStorage): AccountRoster {
  const load = async (): Promise<RosterEntry[]> => parse(await storage.read());

  const save = async (accounts: RosterEntry[]): Promise<void> => {
    const file: RosterFile = { version: 1, accounts };
    await storage.write(`${JSON.stringify(file, null, 2)}\n`);
  };

  return {
    async list() {
      return load();
    },

    async add(entry) {
      const accounts = await load();
      const existing = accounts.findIndex((a) => a.id === entry.id);
      if (existing === -1) accounts.push(entry);
      else accounts[existing] = entry;
      await save(accounts);
    },

    async remove(id) {
      const accounts = await load();
      const remaining = accounts.filter((a) => a.id !== id);
      // Skip the write when nothing changed, so removing an absent account can't
      // rewrite (and so can't corrupt) a roster it wasn't going to alter.
      if (remaining.length !== accounts.length) await save(remaining);
    },
  };
}
