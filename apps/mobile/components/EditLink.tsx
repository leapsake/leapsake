import { Link } from "expo-router";
import { styles } from "../lib/styles";

/**
 * The **Edit** beside a thing on a detail screen — the record's own fields, its
 * tags, one relationship — opening the small screen that changes just that.
 *
 * There was a single Edit in the header for a while, opening one form over the
 * whole record. It answered "how do I change this record?" at the cost of making
 * every change a trip through a screen of everything, with one Save at the end
 * of it and nothing written until then; an accidental swipe partway down took
 * the lot with it. Each affordance is back beside what it affects, and each Save
 * now means one thing is durably written.
 *
 * `what` is spelled out for a screen reader, which would otherwise hear a page
 * of bare "Edit"s with nothing to tell them apart.
 */
export function EditLink({ href, what }: { href: string; what: string }) {
  return (
    <Link
      href={href}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${what}`}
      style={styles.link}
    >
      Edit
    </Link>
  );
}
