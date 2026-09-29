// The account roster: unencrypted, outside every store, over an injected
// storage port. See the README's _The rules worth knowing_.

/** One account known to this device. */
export interface RosterEntry {
  /** Stable account id — also the store's directory name (`paths.ts`). */
  id: string;
  /** The login handle chosen at account creation. */
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
  /** Removes an account, as Forget account does; a no-op when absent. */
  remove(id: string): Promise<void>;
  /** Swaps one account for another in one write, keeping its position; with
   *  `oldId` absent, a plain add. See the README. */
  replace(oldId: string, entry: RosterEntry): Promise<void>;
}

/** The on-disk shape, versioned for a later migration. */
interface RosterFile {
  version: 1;
  accounts: RosterEntry[];
}

/** Parses the roster, anything unreadable as empty: it is read before any UI
 *  could report an error. */
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
    // Keep the usable entries of a partly written array, not none of them.
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

/** Add `entry`, or overwrite the row already holding its id, in place. */
function upsert(accounts: RosterEntry[], entry: RosterEntry): RosterEntry[] {
  const at = accounts.findIndex((a) => a.id === entry.id);
  if (at === -1) accounts.push(entry);
  else accounts[at] = entry;
  return accounts;
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
      await save(upsert(await load(), entry));
    },

    async remove(id) {
      const accounts = await load();
      const remaining = accounts.filter((a) => a.id !== id);
      // No write when nothing changed, so nothing unchanged can be corrupted.
      if (remaining.length !== accounts.length) await save(remaining);
    },

    async replace(oldId, entry) {
      const accounts = await load();
      const at = accounts.findIndex((a) => a.id === oldId);
      if (at === -1) {
        await save(upsert(accounts, entry));
        return;
      }
      accounts[at] = entry;
      // Any other row with the incoming id is now a duplicate.
      await save(accounts.filter((a, i) => i === at || a.id !== entry.id));
    },
  };
}
