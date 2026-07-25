import type { GiftIdea } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import {
  GiftCaptureForm,
  type PartyOption,
} from "../components/GiftCaptureForm";

/**
 * Add a gift — the standalone create screen (reached from the Gifts list's "Add
 * a gift" link). Type a name/URL to capture an idea; add people/pets to suggest
 * it; add dates under a recipient to log givings. Returns to the list on save.
 */
export function GiftCreate() {
  const { ideas, candidates } = useLoaderData() as {
    ideas: GiftIdea[];
    candidates: PartyOption[];
  };

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gifts", to: "/gifts" },
          { label: "Add a gift" },
        ]}
      />
      <h1>Add a gift</h1>
      <GiftCaptureForm
        ideaPool={ideas}
        recipientCandidates={candidates}
        redirectTo="/gifts"
      />
      <p>
        <Link to="/gifts">Cancel</Link>
      </p>
    </main>
  );
}
