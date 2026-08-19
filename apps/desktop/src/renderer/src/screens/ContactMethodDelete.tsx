import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
import { findPlatform } from "@leapsake/contact-links";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/** The person the contact method being removed hangs off of. */
interface Subject {
  id: string;
  label: string;
}

/** A short description of the method being removed, for the confirmation copy. */
function describe(entry: ContactMethod): string {
  const labelText = entry.method.label;
  if (entry.kind === "email")
    return `${labelText} email ${entry.method.address}`;
  if (entry.kind === "phone")
    return `${labelText} phone ${entry.method.number}`;
  if (entry.kind === "social") {
    const name =
      findPlatform(entry.method.platform)?.name ?? entry.method.platform;
    return `${labelText} ${name} profile ${entry.method.handle}`.trimEnd();
  }
  return `${labelText} address (${formatPostalAddress(entry.method)})`;
}

export function ContactMethodDelete() {
  const { subject, entry } = useLoaderData() as {
    subject: Subject;
    entry: ContactMethod;
  };
  const subjectPath = `/people/${subject.id}`;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: subject.label, href: subjectPath },
        { label: "Remove contact" },
      ]}
      heading="Remove contact method?"
      confirmLabel="Remove"
      cancelTo={subjectPath}
      submitting={useSubmitting()}
    >
      Remove {describe(entry)} from {subject.label}?
    </ConfirmDelete>
  );
}
