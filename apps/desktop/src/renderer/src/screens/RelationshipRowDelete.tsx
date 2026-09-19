import type { EntityType } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/** One endpoint of the relationship being removed. */
interface Partner {
  type: EntityType;
  id: string;
  label: string;
}

/** Remove the relationship's one shared row, for both partners at once. */
export function RelationshipRowDelete() {
  const { relationshipId, title, partners } = useLoaderData() as {
    relationshipId: string;
    title: string;
    partners: [Partner, Partner];
  };
  const relPath = `/relationships/${relationshipId}`;
  const [a, b] = partners;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: title, href: relPath },
        { label: "Remove relationship" },
      ]}
      heading="Remove relationship?"
      confirmLabel="Remove"
      cancelTo={relPath}
      submitting={useSubmitting()}
    >
      Remove the relationship between {a.label} and {b.label}? This removes it
      for both of them, but does not delete either {a.label} or {b.label}.
    </ConfirmDelete>
  );
}
