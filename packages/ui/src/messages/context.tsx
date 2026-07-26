import { type ReactNode, createContext, useContext } from "react";
import type { Messages } from "./types.js";

const MessagesContext = createContext<Messages | null>(null);

/**
 * Supplies the catalog every component reads its text from.
 *
 * Deliberately dumb: it holds one object and hands it out. Locale negotiation,
 * catalog loading and message formatting are an i18n library's job, and when one
 * arrives it replaces this file and `en.ts` — the components, which only read a
 * typed object, don't change.
 */
export function MessagesProvider({
  messages,
  children,
}: {
  messages: Messages;
  children: ReactNode;
}) {
  return (
    <MessagesContext.Provider value={messages}>
      {children}
    </MessagesContext.Provider>
  );
}

/**
 * Read the catalog. Throws when none is mounted rather than falling back to
 * English: a silent fallback would ship untranslated text to a translated app,
 * which is precisely the bug this indirection exists to prevent.
 */
export function useMessages(): Messages {
  const messages = useContext(MessagesContext);
  if (messages === null) {
    throw new Error(
      "@leapsake/ui: no MessagesProvider found. Wrap the app in <MessagesProvider messages={en}> — see packages/ui/README.md.",
    );
  }
  return messages;
}
