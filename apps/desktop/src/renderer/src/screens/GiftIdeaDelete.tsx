import type { GiftIdea } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

export function GiftIdeaDelete() {
  const idea = useLoaderData() as GiftIdea;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: "Gifts", href: "/gifts" },
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
