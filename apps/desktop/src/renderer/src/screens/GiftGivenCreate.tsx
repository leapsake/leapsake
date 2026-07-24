import type { GiftIdea } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GiftGivenForm } from "../components/GiftGivenForm";
import { entityBasePath } from "../lib/entityLabel";

/** The recipient a giving is being logged for, resolved for the heading + return. */
export interface GiftGivenRecipient {
  type: "person" | "pet";
  id: string;
  label: string;
}

/**
 * Log a gift given to a recipient (reached from their "Gifts given" section).
 * The create action attributes the giver to you (the self-person) and returns to
 * the recipient's page.
 */
export function GiftGivenCreate() {
  const { recipient, ideas } = useLoaderData() as {
    recipient: GiftGivenRecipient;
    ideas: GiftIdea[];
  };
  const back = `${entityBasePath(recipient.type)}/${recipient.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: recipient.label, to: back },
          { label: "Log a gift" },
        ]}
      />
      <h1>Log a gift given to {recipient.label}</h1>
      <GiftGivenForm ideas={ideas} cancelTo={back} />
    </main>
  );
}
