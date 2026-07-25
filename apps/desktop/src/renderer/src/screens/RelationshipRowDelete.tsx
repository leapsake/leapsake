import type { EntityType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

/** One endpoint of the relationship being removed. */
interface Partner {
  type: EntityType;
  id: string;
  label: string;
}

/**
 * Remove a relationship as a whole, addressed by the relationship itself. A
 * relationship is a single shared row, so this removes it for *both* partners at
 * once — unlike the subject-scoped remove reached from one person's page, which
 * frames it as dropping a single neighbor. Neither partner entity is deleted.
 */
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
        { label: title, to: relPath },
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
