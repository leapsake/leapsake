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

**Built:** `canAttach` and `attachTarget`, specified in
[`@leapsake/contact-import`](../../packages/contact-import/README.md) → _Attaching a contact to a
stored person_. Still to wire: only active, published people are targets, and a contact in the
same import attaches to a person an earlier one created.

## What an attach does — next

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
