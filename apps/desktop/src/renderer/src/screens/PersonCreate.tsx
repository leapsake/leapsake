import { Breadcrumbs } from "../components/Breadcrumbs";
import { PersonForm } from "../components/PersonForm";

export function PersonCreate() {
  return (
    <main>
      <Breadcrumbs
        trail={[{ label: "People", to: "/" }, { label: "Add person" }]}
      />
      <PersonForm title="Add a person" submitLabel="Add" cancelTo="/" />
    </main>
  );
}
