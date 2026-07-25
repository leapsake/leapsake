import type { GiftIdea } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { Link, useLoaderData } from "react-router-dom";
import {
  GiftCaptureForm,
  type PartyOption,
} from "../components/GiftCaptureForm";
import { homeCrumb } from "../lib/crumbs";

/**
 * Add a gift — the standalone create screen (reached from the Gifts list's "Add
 * a gift" link). Type a name/URL to capture an idea; add people/pets to suggest
 * it; add dates under a recipient to log givings. Returns to the list on save.
 *
 * Reached with a recipient already chosen (`?recipient=…`) when a completed
 * `🎁 gift` reminder hands off — then the picker collapses to that one person or
 * pet and the form opens on a date row, since the answer to "record what you
 * gave" is a giving, not a shortlist.
 */
export function GiftCreate() {
  const { ideas, candidates, fixedRecipient } = useLoaderData() as {
    ideas: GiftIdea[];
    candidates: PartyOption[];
    fixedRecipient?: PartyOption;
  };

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gifts", href: "/gifts" },
          { label: "Add a gift" },
        ]}
      />
      <h1>Add a gift</h1>
      {fixedRecipient !== undefined && (
        <p>
          Recording a gift for <strong>{fixedRecipient.label}</strong>.
        </p>
      )}
      <GiftCaptureForm
        ideaPool={ideas}
        fixedRecipient={fixedRecipient}
        recipientCandidates={
          fixedRecipient === undefined ? candidates : undefined
        }
        startWithGiving={fixedRecipient !== undefined}
        redirectTo="/gifts"
      />
      <p>
        <Link to="/gifts">Cancel</Link>
      </p>
    </main>
  );
}
