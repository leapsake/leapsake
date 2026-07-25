// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedSearch } from "../src/headless/index.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.useFakeTimers());

function Host({
  search,
  enabled = true,
}: {
  search: (query: string) => Promise<string[]>;
  enabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const stable = useCallback(search, [search]);
  const results = useDebouncedSearch({ query, search: stable, enabled });

  return (
    <>
      <button type="button" onClick={() => setQuery("ada")}>
        ada
      </button>
      <button type="button" onClick={() => setQuery("adam")}>
        adam
      </button>
      <button type="button" onClick={() => setQuery("")}>
        clear
      </button>
      <output data-testid="results">{results.join(",")}</output>
    </>
  );
}

const results = () => screen.getByTestId("results").textContent;
const click = (name: string) => act(() => screen.getByText(name).click());
/** Advance past the debounce and let the search promise settle. */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
};

describe("useDebouncedSearch", () => {
  it("searches once the query passes the floor", async () => {
    render(<Host search={async (q) => [`hit:${q}`]} />);

    click("ada");
    await settle();
    expect(results()).toBe("hit:ada");
  });

  it("does not search below the minimum length", async () => {
    const search = vi.fn(async () => ["hit"]);
    render(<Host search={search} />);

    await settle();
    expect(search).not.toHaveBeenCalled();
    expect(results()).toBe("");
  });

  it("debounces, so typing through a word searches once", async () => {
    const search = vi.fn(async (q: string) => [`hit:${q}`]);
    render(<Host search={search} />);

    click("ada");
    click("adam");
    await settle();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("adam");
  });

  it("drops a slow response that a newer query has superseded", async () => {
    // The failure this prevents: an early, slower search resolving last and
    // repainting the list with results for a query the user has moved past.
    const search = vi.fn((q: string) =>
      q === "ada"
        ? new Promise<string[]>((resolve) =>
            setTimeout(() => resolve(["slow:ada"]), 500),
          )
        : Promise.resolve(["fast:adam"]),
    );
    render(<Host search={search} />);

    click("ada");
    await settle(); // "ada" is now in flight and will resolve late
    click("adam");
    await settle();
    expect(results()).toBe("fast:adam");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600); // the stale response lands
    });
    expect(results()).toBe("fast:adam");
  });

  it("clears immediately when the query drops below the floor", async () => {
    render(<Host search={async (q) => [`hit:${q}`]} />);

    click("ada");
    await settle();
    expect(results()).toBe("hit:ada");

    click("clear");
    // No timer advance: clearing must not wait on a round trip.
    expect(results()).toBe("");
  });

  it("fetches nothing while disabled", async () => {
    const search = vi.fn(async () => ["hit"]);
    render(<Host search={search} enabled={false} />);

    click("ada");
    await settle();
    expect(search).not.toHaveBeenCalled();
    expect(results()).toBe("");
  });
});
