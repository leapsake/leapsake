import type { Reminder } from "@leapsake/schema";
import { reminderLabel } from "@leapsake/schema";
import { Link } from "react-router-dom";

/**
 * The "Mentioned in" section shared by the Person and Pet view screens — the
 * reverse of an inline `@mention`. Lists every reminder whose text mentions this
 * entity (including its own system birthday reminder), each linking to the
 * reminder. Display-only, and always rendered with an empty placeholder — a
 * first-class section alongside Tags and Milestones. A mention isn't edited here;
 * it lives in the reminder text, so the row opens the reminder's edit screen (a
 * reminder's actionable page on desktop, matching the tag page), where changing
 * the text re-derives the backlink.
 */
export function MentionedInSection({ reminders }: { reminders: Reminder[] }) {
  return (
    <section>
      <header>
        <h2>Mentioned in</h2>
      </header>
      {reminders.length === 0 ? (
        <p>Not mentioned in any reminders.</p>
      ) : (
        <ul>
          {reminders.map((reminder) => (
            <li key={reminder.id}>
              <Link to={`/reminders/${reminder.id}/edit`}>
                {reminderLabel(reminder)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
