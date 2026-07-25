import type { Tag } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

export function TagDelete() {
  const { tag, count } = useLoaderData() as { tag: Tag; count: number };
  const tagPath = `/tags/${tag.id}`;

  return (
    <ConfirmDelete
      trail={[homeCrumb, { label: tag.name, to: tagPath }, { label: "Delete" }]}
      heading={`Delete “${tag.name}”?`}
      confirmLabel="Delete"
      cancelTo={tagPath}
      submitting={useSubmitting()}
    >
      This removes the tag from{" "}
      {count === 0
        ? "everything"
        : `${count} ${count === 1 ? "entity" : "entities"}`}{" "}
      currently tagged with it. The tagged items themselves are not deleted.
    </ConfirmDelete>
  );
}
