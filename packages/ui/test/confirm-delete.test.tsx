// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmDelete } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const trail = [
  { label: "People & Pets", href: "/people" },
  { label: "Ada Lovelace", href: "/people/1" },
];

function renderScreen(
  props: Partial<Parameters<typeof ConfirmDelete>[0]> = {},
) {
  return renderWithUi(
    <ConfirmDelete
      trail={trail}
      heading="Delete Ada Lovelace?"
      confirmLabel="Delete"
      cancelTo="/people/1"
      submitting={false}
      {...props}
    >
      Are you sure you want to delete Ada Lovelace?
    </ConfirmDelete>,
  );
}

describe("ConfirmDelete", () => {
  it("asks the question, explains it, and offers both ways out", () => {
    renderScreen();

    expect(screen.getByRole("heading").textContent).toBe(
      "Delete Ada Lovelace?",
    );
    expect(
      screen.getByText("Are you sure you want to delete Ada Lovelace?"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/people/1");
  });

  it("posts to the route it is on, so the action needs no explicit target", () => {
    renderScreen();

    const form = screen.getByRole("button", { name: "Delete" }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.hasAttribute("action")).toBe(false);
  });

  it("disables the confirm button while submitting", () => {
    // The guard against a double-click posting a destructive action twice.
    // Asserted with `:disabled` rather than the `disabled` IDL property, which
    // reflects only the element's own attribute — the button here is disabled by
    // its ancestor <fieldset>, which is what the browser actually acts on.
    renderScreen({ submitting: true });

    expect(
      screen.getByRole("button", { name: "Delete" }).matches(":disabled"),
    ).toBe(true);
  });

  it("leaves the button live before submission starts", () => {
    renderScreen();

    expect(
      screen.getByRole("button", { name: "Delete" }).matches(":disabled"),
    ).toBe(false);
  });

  it("submits hidden fields even once the fieldset is disabled", () => {
    // The inferred-relationship dismiss has no stored id: losing these to a
    // disabled fieldset would post an unidentifiable edge.
    const { container } = renderScreen({
      submitting: true,
      hiddenFields: { otherType: "person", otherId: "42", role: "parent" },
    });

    const hidden = [...container.querySelectorAll("input[type=hidden]")];
    expect(
      hidden.map((i) => [
        i.getAttribute("name"),
        (i as HTMLInputElement).value,
      ]),
    ).toEqual([
      ["otherType", "person"],
      ["otherId", "42"],
      ["role", "parent"],
    ]);
    // Outside the fieldset — the browser drops disabled controls on submit.
    expect(hidden.every((i) => i.closest("fieldset") === null)).toBe(true);
  });

  it("renders no hidden fields when none are given", () => {
    const { container } = renderScreen();
    expect(container.querySelectorAll("input[type=hidden]").length).toBe(0);
  });
});
