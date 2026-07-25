import type { GiftIdea } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

export function GiftIdeaDelete() {
  const idea = useLoaderData() as GiftIdea;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Gifts", to: "/gifts" },
        { label: "Remove gift idea" },
      ]}
      heading="Remove gift idea?"
      confirmLabel="Remove"
      cancelTo="/gifts"
      submitting={useSubmitting()}
    >
      Remove “{idea.title}”?
    </ConfirmDelete>
  );
}
