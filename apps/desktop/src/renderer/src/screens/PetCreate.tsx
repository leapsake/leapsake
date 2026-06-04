import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PetForm } from "../components/PetForm";

export function PetCreate() {
  return (
    <main>
      <Breadcrumbs trail={[homeCrumb, { label: "Add pet" }]} />
      <PetForm title="Add a pet" submitLabel="Add" cancelTo="/" />
    </main>
  );
}
