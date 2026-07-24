import type { GiftForRecipient } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router-dom";

/**
 * The "Gifts given" section on a Person or Pet screen — the recipient's log of
 * gifts they were given (a giving is a dated event, distinct from the milestone
 * timeline: it has a second party and no reminder schedule, so it gets its own
 * section reusing the partial-date shape, not the rendering). v1 logs "I gave X
 * to Y" (giver = the self-person); received / third-party gifts are pure UI
 * increments against the same schema.
 */
export function GiftsGivenSection({
  recipientType,
  recipientId,
  recipientLabel,
  gifts,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  gifts: GiftForRecipient[];
}) {
  const revalidator = useRevalidator();

  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove(id: string) {
    setBusy(true);
    setError(null);
    inFlight.current = inFlight.current
      .then(() => window.api.gifts.given.softDelete(id))
      .then(
        () => revalidator.revalidate(),
        (e: unknown) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section>
      <header>
        <h2>Gifts given</h2>
      </header>

      {error !== null && <p>Couldn't save: {error}</p>}

      <p>
        <Link to={`/gifts/given/new?to=${recipientType}:${recipientId}`}>
          {`Log a gift given to ${recipientLabel}`}
        </Link>
      </p>

      {gifts.length === 0 ? (
        <p>Nothing recorded yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Gift</th>
              <th>From</th>
              <th>When</th>
              <th>Occasion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gifts.map((g) => {
              const when = formatGiftDate(g);
              return (
                <tr key={g.id}>
                  <td>
                    <Link to={`/gifts/${g.giftIdeaId}/edit`}>
                      {g.ideaTitle}
                    </Link>
                    {g.ideaUrl !== null && (
                      <>
                        {" "}
                        <a href={g.ideaUrl} target="_blank" rel="noreferrer">
                          link
                        </a>
                      </>
                    )}
                  </td>
                  <td>{g.giverLabel ?? "Unknown"}</td>
                  <td>{when === "" ? "—" : when}</td>
                  <td>{g.occasionLabel ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(g.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
