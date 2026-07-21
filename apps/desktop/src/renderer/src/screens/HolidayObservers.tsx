import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { useMemo, useState } from "react";
import { useLoaderData, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";

/**
 * "Christmas — who do you celebrate with?" — the bulk-assignment on-ramp.
 *
 * This screen is load-bearing rather than convenient. With no implicit source of
 * observances (religion isn't recorded, and country lives on contact methods
 * rather than on the person), *every* observance starts explicit — so without a
 * way to answer for the whole address book in one pass, the feature has no entry
 * point and dies of data entry (holidays/research.md §2.12).
 *
 * Hence holiday-centric rather than person-centric: one pass per holiday covers
 * everyone, where a per-person toggle would be N screens for N people.
 */
export function HolidayObservers() {
  const { holiday, candidates } = useLoaderData() as {
    holiday: HolidayDetail;
    candidates: HolidayObserverCandidate[];
  };
  const navigate = useNavigate();

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.observes).map((c) => keyOf(c))),
  );
  const [saving, setSaving] = useState(false);

  const allChecked =
    candidates.length > 0 && checked.size === candidates.length;
  const chosen = useMemo(() => checked.size, [checked]);

  function toggle(candidate: HolidayObserverCandidate) {
    const key = keyOf(candidate);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(candidates.map(keyOf)));
  }

  async function save() {
    setSaving(true);
    // Send an answer for *every* candidate, not just the ticked ones — core
    // decides per row whether that answer needs storing, and an unticked row is
    // how an observance gets cleared or explicitly overridden.
    await window.api.holidays.setObservers(
      holiday.id,
      candidates.map((candidate) => ({
        bearerType: candidate.bearerType,
        bearerId: candidate.bearerId,
        observes: checked.has(keyOf(candidate)),
      })),
    );
    navigate(`/holidays/${holiday.id}`);
  }

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "Holidays", to: "/holidays" },
          { label: holiday.name, to: `/holidays/${holiday.id}` },
          { label: "Who observes it" },
        ]}
      />

      <header>
        <h1>{holiday.name} — who do you celebrate with?</h1>
      </header>

      {candidates.length === 0 ? (
        <p>Add some people first, then come back to say who celebrates.</p>
      ) : (
        <>
          <p>
            <label>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
              />{" "}
              Select all ({candidates.length})
            </label>
          </p>

          <ul>
            {candidates.map((candidate) => {
              const key = keyOf(candidate);
              return (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      onChange={() => toggle(candidate)}
                    />{" "}
                    {candidate.label}
                    {candidate.bearerType === "pet" && " (pet)"}
                  </label>
                </li>
              );
            })}
          </ul>

          <button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : `Save ${chosen} of ${candidates.length}`}
          </button>
        </>
      )}
    </main>
  );
}

/** The stable identity of a picker row across renders. */
function keyOf(candidate: HolidayObserverCandidate): string {
  return `${candidate.bearerType}:${candidate.bearerId}`;
}
