import type { GiftSuggestionForIdea } from "@leapsake/core";
import type { GiftIdea } from "@leapsake/schema";
import {
  Breadcrumbs,
  GiftIdeaRecipientsSection,
  type PartyOption,
} from "@leapsake/ui/web";
import { useLoaderData, useRevalidator } from "react-router-dom";
import { GiftIdeaForm } from "../components/GiftIdeaForm";
import { homeCrumb } from "../lib/crumbs";

export function GiftIdeaEdit() {
  const { idea, tagNames, suggestions, candidates } = useLoaderData() as {
    idea: GiftIdea;
    tagNames: string;
    suggestions: GiftSuggestionForIdea[];
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
      <GiftIdeaForm idea={idea} tagNames={tagNames} />

      <GiftIdeaRecipientsSection
        ideaId={idea.id}
        suggestions={suggestions}
        candidates={candidates}
        onChanged={() => revalidator.revalidate()}
      />
    </main>
  );
}
