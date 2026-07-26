import type { Reminder } from "@leapsake/schema";
import { reminderLabel } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The “Mentioned in” section shared by the Person and Pet view screens — the
 * reverse of an inline `@mention`. Lists every reminder whose text mentions this
 * entity (including its own system birthday reminder), each linking to the
 * reminder. Display-only, and always rendered with an empty placeholder — a
 * first-class section alongside Tags and Milestones. A mention isn't edited here;
 * it lives in the reminder text, so the row opens the reminder's edit screen,
 * where changing the text re-derives the backlink.
 */
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
