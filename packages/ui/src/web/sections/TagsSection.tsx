import type { EntityType, Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { Fragment } from "react";
import { entityBasePath } from "../../headless/routes.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** A person's or pet's tags, display-only; they are edited on the form. */
export function TagsSection({
  bearerType,
  bearerId,
  tags,
}: {
  bearerType: EntityType;
  bearerId: string;
  tags: readonly Tag[];
}) {
  const { Link } = useUi();
  const m = useMessages();
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

  return (
    <Section
      title={m.tags.title}
      actions={<Link href={`${basePath}/edit`}>{m.tags.edit}</Link>}
    >
      {tags.length === 0 ? (
        <EmptyState>{m.tags.empty}</EmptyState>
      ) : (
        <p>
          {tags.map((tag, index) => (
            <Fragment key={tag.id}>
              {index > 0 && ", "}
              <Link href={`/tags/${tag.id}`}>{tagLabel(tag.name)}</Link>
            </Fragment>
          ))}
        </p>
      )}
    </Section>
  );
}
