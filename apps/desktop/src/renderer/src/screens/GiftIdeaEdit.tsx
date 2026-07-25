import type { GiftSuggestionForIdea } from "@leapsake/core";
import type { GiftIdea } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { GiftIdeaForm } from "../components/GiftIdeaForm";
import {
  GiftIdeaRecipientsSection,
  type RecipientCandidate,
} from "../components/GiftIdeaRecipientsSection";
import { homeCrumb } from "../lib/crumbs";

export function GiftIdeaEdit() {
  const { idea, tagNames, suggestions, candidates } = useLoaderData() as {
    idea: GiftIdea;
    tagNames: string;
    suggestions: GiftSuggestionForIdea[];
    candidates: RecipientCandidate[];
  };

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
      />
    </main>
  );
}
