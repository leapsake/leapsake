// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUi } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

// Vitest runs without globals, so Testing Library can't register its own
// auto-cleanup — without this, `screen` sees every earlier test's markup too.
afterEach(cleanup);

function Consumer() {
  const { Link, Form } = useUi();
  return (
    <Form method="post" action="/people/1/delete">
      <Link href="/people/1">Back</Link>
      <button type="submit">Delete</button>
    </Form>
  );
}

describe("UiProvider", () => {
  it("supplies the host's Link and Form to components below it", () => {
    renderWithUi(<Consumer />);

    expect(screen.getByRole("link", { name: "Back" })).toHaveProperty(
      "pathname",
      "/people/1",
    );
    // The form must survive as a real submitting element — that is the no-JS floor.
    const form = screen.getByRole("button", { name: "Delete" }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/people/1/delete");
  });

  it("throws a directed error when no provider is mounted", () => {
    // A silent fallback to <a> would look right in dev and drop the router in
    // production, so the failure is loud by design.
    expect(() => render(<Consumer />)).toThrow(/no UiProvider found/);
  });
});
