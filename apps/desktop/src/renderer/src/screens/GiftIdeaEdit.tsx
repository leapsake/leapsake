import type { GiftIdea } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GiftIdeaForm } from "../components/GiftIdeaForm";

export function GiftIdeaEdit() {
  const idea = useLoaderData() as GiftIdea;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gift ideas", to: "/gifts" },
          { label: "Edit gift idea" },
        ]}
      />
      <h1>Edit gift idea</h1>
      <GiftIdeaForm idea={idea} />
    </main>
  );
}
