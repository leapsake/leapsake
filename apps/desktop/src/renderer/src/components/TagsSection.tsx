import type { EntityType, Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/**
 * The Tags section shared by the Person and Pet view screens — a first-class
 * section alongside Relationships and Milestones rather than a row in the
 * identity list. It is display-only: each tag links to its own page, and tags
 * are added/removed back on the create/edit form (the "Edit tags" affordance
 * here opens that form), where they save as a whole set with the entity.
 */
export function TagsSection({
  bearerType,
  bearerId,
  tags,
}: {
  bearerType: EntityType;
  bearerId: string;
  tags: Tag[];
}) {
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

  return (
    <section>
      <header>
        <h2>Tags</h2>
        <Link to={`${basePath}/edit`}>Edit tags</Link>
      </header>
      {tags.length === 0 ? (
        <p>No tags yet.</p>
      ) : (
        <p>
          {tags.map((tag, index) => (
            <Fragment key={tag.id}>
              {index > 0 && ", "}
              <Link to={`/tags/${tag.id}`}>{tagLabel(tag.name)}</Link>
            </Fragment>
          ))}
        </p>
      )}
    </section>
  );
}
