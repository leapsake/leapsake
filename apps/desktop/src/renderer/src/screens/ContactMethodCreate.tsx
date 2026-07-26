import type { ContactMethodKind } from "@leapsake/schema";
import { Breadcrumbs, ContactMethodForm } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The person a new contact method hangs off of. */
interface Subject {
  id: string;
  label: string;
}

export function ContactMethodCreate() {
  const { subject, kind } = useLoaderData() as {
    subject: Subject;
    kind: ContactMethodKind;
  };
  const subjectPath = `/people/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, href: subjectPath },
          { label: "Add contact" },
        ]}
      />
      <ContactMethodForm
        kind={kind}
        cancelTo={subjectPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
