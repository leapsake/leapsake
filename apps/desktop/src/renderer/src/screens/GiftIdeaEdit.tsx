import type { GiftIdea } from "@leapsake/schema";
import {
  Breadcrumbs,
  GiftIdeaForm,
  GiftIdeaRecipientsSection,
  type IdeaRecipientRow,
  type PartyOption,
} from "@leapsake/ui/web";
import { useLoaderData, useRevalidator } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { searchEntities } from "../lib/search";
import { useSubmitting } from "../lib/useSubmitting";

export function GiftIdeaEdit() {
  const { idea, tagNames, recipients, candidates } = useLoaderData() as {
    idea: GiftIdea;
    tagNames: string;
    recipients: IdeaRecipientRow[];
    candidates: PartyOption[];
  };
  // The section writes directly rather than through a route action, so it
  // re-reads this screen's loader data itself once a write lands.
  const revalidator = useRevalidator();

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gifts", href: "/gifts" },
          { label: "Edit gift idea" },
        ]}
      />
      <h1>Edit gift idea</h1>
      <GiftIdeaForm
        idea={idea}
        tagNames={tagNames}
        search={searchEntities}
        submitting={useSubmitting()}
      />

      <GiftIdeaRecipientsSection
        ideaId={idea.id}
        recipients={recipients}
        candidates={candidates}
        onChanged={() => revalidator.revalidate()}
      />
    </main>
  );
}
