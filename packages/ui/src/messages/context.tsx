import { type ReactNode, createContext, useContext } from "react";
import type { Messages } from "./types.js";

const MessagesContext = createContext<Messages | null>(null);

/** Supplies the catalog every component reads its text from. */
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

/** Reads the catalog; throws when none is mounted, never falling back. */
export function useMessages(): Messages {
  const messages = useContext(MessagesContext);
  if (messages === null) {
    throw new Error(
      "@leapsake/ui: no MessagesProvider found. Wrap the app in <MessagesProvider messages={en}> — see packages/ui/README.md.",
    );
  }
  return messages;
}
