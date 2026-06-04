import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PersonForm } from "../components/PersonForm";

export function PersonCreate() {
  return (
    <main>
      <Breadcrumbs trail={[homeCrumb, { label: "Add person" }]} />
      <PersonForm title="Add a person" submitLabel="Add" cancelTo="/" />
    </main>
  );
}
