import type { GiftIdea } from "@leapsake/schema";
import {
  Breadcrumbs,
  GiftCaptureForm,
  type PartyOption,
} from "@leapsake/ui/web";
import { Link, useLoaderData, useNavigate } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";

/**
 * Capture an idea, suggest it for people and log givings. With `?recipient=…`,
 * from a done gift reminder, the form is fixed to them and opens on a date.
 */
export function GiftCreate() {
  const { ideas, candidates, fixedRecipient } = useLoaderData() as {
    ideas: GiftIdea[];
    candidates: PartyOption[];
    fixedRecipient?: PartyOption;
  };
  const navigate = useNavigate();

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
        startGiven={fixedRecipient !== undefined}
        // Back to the list; the inline sections stay put and re-read instead.
        onSaved={() => navigate("/gifts")}
      />
      <p>
        <Link to="/gifts">Cancel</Link>
      </p>
    </main>
  );
}
