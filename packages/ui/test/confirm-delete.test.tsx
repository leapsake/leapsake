// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmDelete } from "../src/web/index.js";
import { recordSubmits, renderWithUi } from "./support.js";

afterEach(cleanup);

const trail = [
  { label: "People & Pets", href: "/people" },
  { label: "Mary Bailey", href: "/people/1" },
];

function renderScreen(
  props: Partial<Parameters<typeof ConfirmDelete>[0]> = {},
) {
  return renderWithUi(
    <ConfirmDelete
      trail={trail}
      heading="Delete Mary Bailey?"
      confirmLabel="Delete"
      cancelTo="/people/1"
      submitting={false}
      {...props}
    >
      Are you sure you want to delete Mary Bailey?
    </ConfirmDelete>,
  );
}

describe("ConfirmDelete", () => {
  it("asks the question, explains it, and offers both ways out", () => {
    renderScreen();

    expect(screen.getByRole("heading").textContent).toBe("Delete Mary Bailey?");
    expect(
      screen.getByText("Are you sure you want to delete Mary Bailey?"),
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

  it("ignores a second press while submitting, without disabling", () => {
    const stopped = recordSubmits();
    renderScreen({ submitting: true });
    const confirm = screen.getByRole("button", { name: "Delete" });

    expect(confirm.matches(":disabled")).toBe(false);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    expect(stopped()).toEqual([true]);
  });

  it("leaves the button live before submission starts", () => {
    renderScreen();

    expect(
      screen.getByRole("button", { name: "Delete" }).matches(":disabled"),
    ).toBe(false);
  });

  it("submits its hidden fields", () => {
    // The inferred-relationship dismiss has no stored id: without these it
    // would post an unidentifiable edge.
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
