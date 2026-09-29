import { Link } from "expo-router";
import { styles } from "../lib/styles";

/**
 * The Edit beside one part of a record. `what` names it for a screen reader;
 * `action` spells the phrase out, which lets an empty section say Add.
 */
export function EditLink({
  href,
  what,
  action,
}: {
  href: string;
  what: string;
  /** Spell the whole phrase out on screen, with this verb. */
  action?: "add" | "edit";
}) {
  const label =
    action === undefined
      ? `Edit ${what}`
      : `${action === "add" ? "Add" : "Edit"} ${what}`;

  return (
    <Link
      href={href}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.link}
    >
      {action === undefined ? "Edit" : label}
    </Link>
  );
}
