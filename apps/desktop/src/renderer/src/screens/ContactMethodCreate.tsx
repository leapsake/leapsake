import type { ContactMethodKind } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { ContactMethodForm } from "../components/ContactMethodForm";

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
          { label: subject.label, to: subjectPath },
          { label: "Add contact" },
        ]}
      />
      <ContactMethodForm kind={kind} cancelTo={subjectPath} />
    </main>
  );
}
