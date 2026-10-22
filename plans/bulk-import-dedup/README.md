# Bulk-import dedup

Stop an import from creating a second person for someone Leapsake already holds. Terms are in
[`GLOSSARY.md`](./GLOSSARY.md). This folder is deleted when the work lands; see
[`../README.md`](../README.md) → _The rule for every doc here_.

## Scope

- **Mobile's phone-contacts sync first.** It has no review screen and runs unattended, so every
  decision here is automatic. Desktop's drag-and-drop review gets the same logic as a third
  choice per row later, when desktop is next worked on.
- **Both directions, weighted to the first:** an incoming contact against people already
  stored, and contacts in the same import against each other.
- **The link already prevents the easy case.** A contact imported once is never imported again
  on the same phone. What it cannot see: a second phone, a restore under new ids, or a contact
  deleted and re-added. Those are what attaching is for.

## When a contact attaches

Only when it is **compatible** with exactly one stored person and they **agree**:

- **Agreement:** full names equal, ignoring case and accents (a middle name on one side only is
  fine), plus at least one more shared value: an email, phone, handle or birthday.
- **Conflicts that block:** any name part, gender, birthday, or a dated occasion of the same
  kind that differs. A birthday with no year on one side is compatible if month and day agree.
- **Lists conflict per label.** Emails, phones and addresses are grouped by label (case and
  spacing ignored), handles by platform. A label both sides use must share at least one value
  under it, so a changed "Mobile" number blocks the attach and leaves it to the review. An
  unlabelled or "Other" entry never conflicts, and neither do different labels ("iPhone" and
  "Mobile"); entries that differ without conflicting are added.
- **Tags and related people** never conflict; they add.
- **Compatible with two or more people:** do not attach. Create, and let the duplicates review
  show them all.
- **Only active, published people are targets.** A deleted person comes back as new, as a
  re-imported card already does; an unpublished one is left alone.
- **Contacts in the same import** attach to a person an earlier contact in it created, by the
  same rule.

Anything short of that is created as today, and the existing duplicates review offers the merge.

## What an attach does

- Writes the link from the contact to the person.
- Adds whatever the contact has that the person lacks. By construction nothing conflicts, so
  nothing is overwritten.
- The import's done screen reports a count of attached contacts in one line. Background sync
  runs stay silent, as now.

## Not in scope

- **Anything already in the store.** The rule applies to imports from here on; existing
  duplicate pairs stay with the duplicates review.
- **`not_a_duplicate`.** A dismissal names two stored people, and an incoming contact has no id
  until it is created, so no dismissal can apply to an attach.
