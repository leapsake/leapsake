import type { GiftSuggestionForIdea } from "@leapsake/core";
import type { GiftIdea } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GiftIdeaForm } from "../components/GiftIdeaForm";
import {
  GiftIdeaRecipientsSection,
  type RecipientCandidate,
} from "../components/GiftIdeaRecipientsSection";

export function GiftIdeaEdit() {
  const { idea, suggestions, candidates } = useLoaderData() as {
    idea: GiftIdea;
    suggestions: GiftSuggestionForIdea[];
    candidates: RecipientCandidate[];
  };

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gifts", to: "/gifts" },
          { label: "Edit gift idea" },
        ]}
      />
      <h1>Edit gift idea</h1>
      <GiftIdeaForm idea={idea} />

      <GiftIdeaRecipientsSection
        ideaId={idea.id}
        suggestions={suggestions}
        candidates={candidates}
      />
    </main>
  );
}
