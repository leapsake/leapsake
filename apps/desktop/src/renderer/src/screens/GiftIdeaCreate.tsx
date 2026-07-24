import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GiftIdeaForm } from "../components/GiftIdeaForm";

export function GiftIdeaCreate() {
  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gift ideas", to: "/gifts" },
          { label: "Add gift idea" },
        ]}
      />
      <h1>Add gift idea</h1>
      <GiftIdeaForm />
    </main>
  );
}
