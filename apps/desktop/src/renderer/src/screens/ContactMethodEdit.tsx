import type { ContactMethod, ContactMethodKind } from "@leapsake/schema";
import { Breadcrumbs, ContactMethodForm } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The person the edited contact method hangs off of. */
interface Subject {
  id: string;
  label: string;
}

export function ContactMethodEdit() {
  const { subject, kind, entry } = useLoaderData() as {
    subject: Subject;
    kind: ContactMethodKind;
    entry: ContactMethod;
  };
  const subjectPath = `/people/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, href: subjectPath },
          { label: "Edit contact" },
        ]}
      />
      <ContactMethodForm
        kind={kind}
        entry={entry}
        cancelTo={subjectPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
