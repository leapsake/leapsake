import type { PersonView } from "@leapsake/core";
import { phoneE164 } from "@leapsake/phone";
import {
  type ContactMethod,
  fold,
  formatMilestoneDate,
  formatPostalAddress,
  fullName,
  genderLabel,
  milestoneLabel,
  tagLabel,
} from "@leapsake/schema";
import type { PairFact } from "@leapsake/view-models";
import { methodValue } from "./contact-actions";

const FIELD = {
  name: "Name",
  gender: "Gender",
  email: "Email",
  phone: "Phone",
  social: "Social",
  postal: "Address",
  tags: "Tags",
} as const;

const NO_DATE = "No date";

/** A contact method's match key, as the duplicate scorer would see it. */
function contactKey(entry: ContactMethod, region: string | null): string {
  switch (entry.kind) {
    case "email":
      return entry.method.normalized;
    case "phone":
      return phoneE164(entry.method.number, region) || entry.method.normalized;
    case "social":
      return `${entry.method.platform}:${entry.method.normalized}`;
    case "postal":
      return fold(formatPostalAddress(entry.method));
  }
}

/**
 * What the duplicates review compares about one person: their name, gender,
 * contact methods, own milestones and tags.
 */
export function personFacts(
  view: PersonView,
  region: string | null,
): PairFact[] {
  const name = fullName(view.person);
  const facts: PairFact[] = [
    { field: FIELD.name, key: fold(name), text: name },
  ];
  const gender = view.gender.value;
  if (gender !== null)
    facts.push({ field: FIELD.gender, key: gender, text: genderLabel[gender] });
  for (const entry of view.contactMethods)
    facts.push({
      field: FIELD[entry.kind],
      key: contactKey(entry, region),
      text: methodValue(entry),
    });
  for (const { milestone, origin } of view.timeline) {
    if (origin !== "own") continue;
    const { year, month, day } = milestone;
    facts.push({
      field: milestoneLabel(milestone),
      key: `${year}-${month}-${day}`,
      text: formatMilestoneDate(milestone) || NO_DATE,
    });
  }
  for (const tag of view.tags)
    facts.push({ field: FIELD.tags, key: tag.id, text: tagLabel(tag.name) });
  return facts;
}
