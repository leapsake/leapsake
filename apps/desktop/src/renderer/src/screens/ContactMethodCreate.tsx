import type { ContactMethodKind } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { ContactMethodForm } from "../components/ContactMethodForm";
import { homeCrumb } from "../lib/crumbs";

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
      <ContactMethodForm kind={kind} cancelTo={subjectPath} />
    </main>
  );
}
