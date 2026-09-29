import type { Reminder } from "@leapsake/schema";
import { reminderLabel } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** The reminders whose text mentions this person or pet, each opening its
 *  editor; always rendered, with a placeholder when empty. */
export function MentionedInSection({
  reminders,
}: {
  reminders: readonly Reminder[];
}) {
  const { Link } = useUi();
  const m = useMessages();

  return (
    <Section title={m.mentionedIn.title}>
      {reminders.length === 0 ? (
        <EmptyState>{m.mentionedIn.empty}</EmptyState>
      ) : (
        <ul>
          {reminders.map((reminder) => (
            <li key={reminder.id}>
              <Link href={`/reminders/${reminder.id}/edit`}>
                {reminderLabel(reminder)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
