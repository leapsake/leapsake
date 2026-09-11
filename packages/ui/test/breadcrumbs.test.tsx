// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Breadcrumbs } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

describe("Breadcrumbs", () => {
  it("links every crumb that has an href", () => {
    renderWithUi(
      <Breadcrumbs
        trail={[
          { label: "People & Pets", href: "/people" },
          { label: "Mary Bailey", href: "/people/1" },
          { label: "Delete" },
        ]}
      />,
    );

    expect(
      screen
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["People & Pets", "/people"],
      ["Mary Bailey", "/people/1"],
    ]);
  });

  it("renders the current page as plain text, not a link", () => {
    renderWithUi(
      <Breadcrumbs
        trail={[
          { label: "People & Pets", href: "/people" },
          { label: "Delete" },
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: "Delete" })).toBeNull();
    expect(screen.getByText("Delete").tagName).toBe("SPAN");
  });

  it("separates crumbs and names the trail for assistive tech", () => {
    const { container } = renderWithUi(
      <Breadcrumbs
        trail={[
          { label: "One", href: "/one" },
          { label: "Two", href: "/two" },
        ]}
      />,
    );

    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe(
      "Breadcrumb",
    );
    expect(container.textContent).toBe("One / Two");
  });
});
